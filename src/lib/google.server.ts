/**
 * Server-only helpers for Google OAuth (Gmail + Calendar).
 * Reads GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET from env at call time.
 */

export const GOOGLE_SCOPES = [
  "openid",
  "email",
  "profile",
  "https://www.googleapis.com/auth/gmail.readonly",
  "https://www.googleapis.com/auth/gmail.send",
  "https://www.googleapis.com/auth/gmail.modify",
  "https://www.googleapis.com/auth/calendar",
  "https://www.googleapis.com/auth/calendar.events",
].join(" ");

function getEnv() {
  const id = process.env.GOOGLE_CLIENT_ID;
  const secret = process.env.GOOGLE_CLIENT_SECRET;
  if (!id || !secret) throw new Error("Missing GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET");
  return { id, secret };
}

export function buildAuthUrl(redirectUri: string, state: string) {
  const { id } = getEnv();
  const params = new URLSearchParams({
    client_id: id,
    redirect_uri: redirectUri,
    response_type: "code",
    scope: GOOGLE_SCOPES,
    access_type: "offline",
    prompt: "consent",
    include_granted_scopes: "true",
    state,
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
}

export async function exchangeCodeForTokens(code: string, redirectUri: string) {
  const { id, secret } = getEnv();
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: id,
      client_secret: secret,
      redirect_uri: redirectUri,
      grant_type: "authorization_code",
    }),
  });
  if (!res.ok) throw new Error(`Google token exchange failed: ${res.status} ${await res.text()}`);
  return res.json() as Promise<{
    access_token: string;
    refresh_token?: string;
    expires_in: number;
    scope: string;
    token_type: string;
    id_token?: string;
  }>;
}

export async function refreshAccessToken(refreshToken: string) {
  const { id, secret } = getEnv();
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      refresh_token: refreshToken,
      client_id: id,
      client_secret: secret,
      grant_type: "refresh_token",
    }),
  });
  if (!res.ok) throw new Error(`Refresh failed: ${res.status} ${await res.text()}`);
  return res.json() as Promise<{ access_token: string; expires_in: number; scope: string; token_type: string }>;
}

/** Get a valid access token for the user, refreshing if needed. Updates DB. */
export async function getValidAccessToken(userId: string) {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data: conn, error } = await supabaseAdmin
    .from("google_connections")
    .select("*")
    .eq("user_id", userId)
    .maybeSingle();
  if (error || !conn) throw new Error("Google connection not found");
  const expiresAt = conn.token_expires_at ? new Date(conn.token_expires_at).getTime() : 0;
  if (conn.access_token && expiresAt - 60_000 > Date.now()) return conn.access_token;
  const refreshed = await refreshAccessToken(conn.refresh_token);
  const newExpires = new Date(Date.now() + refreshed.expires_in * 1000).toISOString();
  await supabaseAdmin
    .from("google_connections")
    .update({ access_token: refreshed.access_token, token_expires_at: newExpires })
    .eq("user_id", userId);
  return refreshed.access_token;
}

/** Gmail: list messages newer than a date. */
export async function listRecentMessages(accessToken: string, afterEpochSec: number, max = 20) {
  const q = `in:inbox -from:me newer_than:7d after:${afterEpochSec}`;
  const url = `https://gmail.googleapis.com/gmail/v1/users/me/messages?q=${encodeURIComponent(q)}&maxResults=${max}`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } });
  if (!res.ok) throw new Error(`Gmail list failed: ${res.status}`);
  return res.json() as Promise<{ messages?: { id: string; threadId: string }[]; resultSizeEstimate?: number }>;
}

export async function getGmailMessage(accessToken: string, id: string) {
  const res = await fetch(`https://gmail.googleapis.com/gmail/v1/users/me/messages/${id}?format=full`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) throw new Error(`Gmail get failed: ${res.status}`);
  return res.json();
}

export function decodeBase64Url(data: string) {
  const b64 = data.replace(/-/g, "+").replace(/_/g, "/");
  try {
    return new TextDecoder().decode(Uint8Array.from(atob(b64), (c) => c.charCodeAt(0)));
  } catch {
    return "";
  }
}

export function extractEmailParts(message: any) {
  const headers: { name: string; value: string }[] = message.payload?.headers ?? [];
  const h = (n: string) => headers.find((x) => x.name.toLowerCase() === n.toLowerCase())?.value ?? "";
  const from = h("From");
  const to = h("To");
  const subject = h("Subject");
  const date = h("Date");
  const messageId = h("Message-ID") || h("Message-Id");
  const references = h("References");
  const inReplyTo = h("In-Reply-To");

  let body = "";
  const walk = (part: any) => {
    if (!part) return;
    if (part.mimeType === "text/plain" && part.body?.data) {
      body += decodeBase64Url(part.body.data) + "\n";
    } else if (part.parts) {
      part.parts.forEach(walk);
    } else if (!body && part.body?.data && part.mimeType?.startsWith("text/")) {
      body += decodeBase64Url(part.body.data);
    }
  };
  walk(message.payload);
  if (!body && message.snippet) body = message.snippet;

  // parse "Name <email@x.com>"
  const m = from.match(/^(.*?)\s*<(.+?)>$/);
  const fromName = m ? m[1].replace(/"/g, "").trim() : "";
  const fromEmail = m ? m[2].trim() : from.trim();

  return { from, fromName, fromEmail, to, subject, date, body: body.slice(0, 8000), messageId, references, inReplyTo };
}

export async function sendGmailReply(
  accessToken: string,
  opts: {
    to: string;
    subject: string;
    body: string;
    threadId?: string;
    inReplyToMessageId?: string;
    references?: string;
    fromName?: string;
  },
) {
  const headers = [
    `To: ${opts.to}`,
    `Subject: ${opts.subject}`,
    'Content-Type: text/plain; charset="UTF-8"',
    "MIME-Version: 1.0",
  ];
  if (opts.inReplyToMessageId) headers.push(`In-Reply-To: ${opts.inReplyToMessageId}`);
  if (opts.references || opts.inReplyToMessageId) {
    headers.push(`References: ${[opts.references, opts.inReplyToMessageId].filter(Boolean).join(" ")}`);
  }
  const raw = btoa(unescape(encodeURIComponent([...headers, "", opts.body].join("\r\n"))))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
  const res = await fetch("https://gmail.googleapis.com/gmail/v1/users/me/messages/send", {
    method: "POST",
    headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
    body: JSON.stringify({ raw, threadId: opts.threadId }),
  });
  if (!res.ok) throw new Error(`Gmail send failed: ${res.status} ${await res.text()}`);
  return res.json();
}

/** Calendar: check freebusy + create event */
export async function getFreeBusy(accessToken: string, calendarId: string, timeMin: string, timeMax: string, timeZone: string) {
  const res = await fetch("https://www.googleapis.com/calendar/v3/freeBusy", {
    method: "POST",
    headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
    body: JSON.stringify({ timeMin, timeMax, timeZone, items: [{ id: calendarId }] }),
  });
  if (!res.ok) throw new Error(`FreeBusy failed: ${res.status}`);
  const data = await res.json();
  return (data.calendars?.[calendarId]?.busy ?? []) as { start: string; end: string }[];
}

export async function createCalendarEvent(
  accessToken: string,
  calendarId: string,
  event: {
    id?: string;
    summary: string;
    description?: string;
    start: { dateTime: string; timeZone: string };
    end: { dateTime: string; timeZone: string };
    attendees?: { email: string; displayName?: string }[];
  },
) {
  const res = await fetch(
    `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events?sendUpdates=all`,
    {
      method: "POST",
      headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
      body: JSON.stringify(event),
    },
  );
  if (!res.ok) {
    const error = new Error(`Calendar create failed: ${res.status} ${await res.text()}`) as Error & { status?: number };
    error.status = res.status;
    throw error;
  }
  return res.json();
}

export async function getUserInfo(accessToken: string) {
  const res = await fetch("https://www.googleapis.com/oauth2/v2/userinfo", {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) throw new Error(`userinfo failed: ${res.status}`);
  return res.json() as Promise<{ email: string; name?: string; picture?: string }>;
}
