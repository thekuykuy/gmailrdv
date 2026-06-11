/**
 * Core autonomous agent — runs per user, polls Gmail, analyzes via Lovable AI,
 * checks Calendar, replies, and logs activity.
 */
import { generateObject } from "ai";
import { z } from "zod";
import { createLovableAiGatewayProvider } from "./ai-gateway.server";
import {
  createCalendarEvent,
  extractEmailParts,
  getFreeBusy,
  getGmailMessage,
  getValidAccessToken,
  listRecentMessages,
  sendGmailReply,
} from "./google.server";

const MODEL = "google/gemini-3-flash-preview";

function getAI() {
  const key = process.env.LOVABLE_API_KEY;
  if (!key) throw new Error("Missing LOVABLE_API_KEY");
  return createLovableAiGatewayProvider(key)(MODEL);
}

const AnalysisSchema = z.object({
  is_appointment_request: z.boolean().describe("True si l'email demande explicitement un rendez-vous, une réunion, ou un appel."),
  client_name: z.string().nullable(),
  intent: z.enum(["new_request", "confirm", "decline", "reschedule", "info_only", "other"]),
  requested_datetimes_iso: z.array(z.string()).describe("Créneaux exacts demandés au format ISO 8601 (si déductibles)."),
  duration_minutes: z.number().nullable(),
  summary: z.string().describe("Résumé en une phrase de la demande du client."),
  questions_for_agent: z.array(z.string()).describe("Informations manquantes que l'agent devrait clarifier."),
});

export async function analyzeEmailWithAI(opts: {
  body: string;
  subject: string;
  history: { role: "user" | "assistant"; content: string }[];
  language: string;
  nowIso: string;
  timezone: string;
}) {
  const model = getAI();
  const { object } = await generateObject({
    model,
    schema: AnalysisSchema,
    prompt: `Tu es un classificateur expert. Date actuelle: ${opts.nowIso} (${opts.timezone}).
Analyse cet email (langue préférée: ${opts.language}).

Historique de la conversation:
${opts.history.map((m) => `${m.role.toUpperCase()}: ${m.content}`).join("\n---\n") || "(aucun)"}

NOUVEL EMAIL:
Sujet: ${opts.subject}
Corps:
${opts.body}

Détecte les créneaux mentionnés (ex: "demain 14h", "lundi prochain matin", "vendredi 10/06 à 15h30") et convertis-les en ISO 8601 absolu en utilisant la date actuelle comme référence.`,
  });
  return object;
}

export async function craftReplyWithAI(opts: {
  persona: string;
  language: string;
  clientName: string;
  signature: string;
  context: string;
  proposalType: "slot_available" | "slot_taken_alternatives" | "need_more_info" | "confirm_booked";
  slotsToOffer?: { start: string; end: string }[];
  requestedSlot?: { start: string; end: string };
  questions?: string[];
  timezone: string;
}) {
  const model = getAI();
  const ReplySchema = z.object({
    subject: z.string(),
    body: z.string().describe("Corps de l'email en texte simple, ton naturel et chaleureux. Inclure la signature à la fin."),
  });
  const fmt = (iso: string) =>
    new Date(iso).toLocaleString(opts.language, { dateStyle: "full", timeStyle: "short", timeZone: opts.timezone });
  const slotsBlock = opts.slotsToOffer?.length
    ? `Propose ces créneaux disponibles (présente-les naturellement):\n${opts.slotsToOffer.map((s) => `- ${fmt(s.start)}`).join("\n")}`
    : "";
  const reqBlock = opts.requestedSlot ? `Créneau demandé: ${fmt(opts.requestedSlot.start)}` : "";
  const questionsBlock = opts.questions?.length ? `Questions à poser:\n${opts.questions.map((q) => `- ${q}`).join("\n")}` : "";
  const intent = {
    slot_available: "Le créneau demandé est disponible — confirme et demande la confirmation finale du client.",
    slot_taken_alternatives: "Le créneau demandé n'est PAS disponible — propose intelligemment 2-3 alternatives ci-dessous.",
    need_more_info: "Pose des questions de clarification pour mieux comprendre les besoins.",
    confirm_booked: "Confirme que le rendez-vous est désormais enregistré.",
  }[opts.proposalType];

  const { object } = await generateObject({
    model,
    schema: ReplySchema,
    prompt: `${opts.persona}
Langue: ${opts.language}. Client: ${opts.clientName || "le client"}.
Objectif: ${intent}
${reqBlock}
${slotsBlock}
${questionsBlock}
Contexte conversation:
${opts.context}

Génère un email professionnel, concis, naturel. Termine avec cette signature:
---
${opts.signature || ""}`,
  });
  return object;
}

function isWithinWorkingHours(date: Date, start: string, end: string, days: number[], tz: string) {
  const fmt = new Intl.DateTimeFormat("en-US", { timeZone: tz, hour: "numeric", hour12: false, minute: "numeric", weekday: "short" });
  const parts = fmt.formatToParts(date);
  const wd = parts.find((p) => p.type === "weekday")?.value ?? "";
  const wdMap: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  const dow = wdMap[wd];
  if (!days.includes(dow)) return false;
  const h = Number(parts.find((p) => p.type === "hour")?.value ?? "0");
  const m = Number(parts.find((p) => p.type === "minute")?.value ?? "0");
  const mins = h * 60 + m;
  const [sh, sm] = start.split(":").map(Number);
  const [eh, em] = end.split(":").map(Number);
  return mins >= sh * 60 + sm && mins + 1 <= eh * 60 + em;
}

export function suggestAlternativeSlots(
  busy: { start: string; end: string }[],
  settings: { working_days: number[]; working_hours_start: string; working_hours_end: string; appointment_duration_minutes: number; buffer_minutes: number; timezone: string },
  fromDate: Date,
  count = 3,
) {
  const slots: { start: string; end: string }[] = [];
  const dur = settings.appointment_duration_minutes;
  const buf = settings.buffer_minutes;
  const totalMin = dur + buf;
  const cursor = new Date(fromDate);
  cursor.setMinutes(0, 0, 0);
  cursor.setHours(cursor.getHours() + 1);
  const limit = new Date(fromDate.getTime() + 14 * 86400_000);

  while (cursor < limit && slots.length < count) {
    if (
      isWithinWorkingHours(cursor, settings.working_hours_start, settings.working_hours_end, settings.working_days, settings.timezone)
    ) {
      const end = new Date(cursor.getTime() + dur * 60_000);
      const isBusy = busy.some((b) => {
        const bs = new Date(b.start).getTime();
        const be = new Date(b.end).getTime();
        return cursor.getTime() < be && end.getTime() > bs;
      });
      if (!isBusy) {
        slots.push({ start: cursor.toISOString(), end: end.toISOString() });
        cursor.setTime(cursor.getTime() + totalMin * 60_000);
        continue;
      }
    }
    cursor.setMinutes(cursor.getMinutes() + 30);
  }
  return slots;
}

export async function logActivity(
  userId: string,
  type: string,
  title: string,
  description?: string,
  threadId?: string,
  metadata?: any,
) {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  await supabaseAdmin.from("activity_logs").insert({
    user_id: userId,
    type,
    title,
    description: description ?? null,
    thread_id: threadId ?? null,
    metadata: metadata ?? null,
  });
}

/**
 * Process one Gmail message: classify, decide, reply, optionally book.
 */
export async function processIncomingMessage(userId: string, gmailMessage: any) {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const parts = extractEmailParts(gmailMessage);
  const gmailThreadId: string = gmailMessage.threadId;

  // Skip own outbound (already filtered with -from:me, but double-check)
  const { data: settings } = await supabaseAdmin.from("agent_settings").select("*").eq("user_id", userId).single();
  if (!settings) throw new Error("settings missing");
  if (!settings.agent_enabled) return { skipped: "agent_disabled" };

  // Upsert thread
  let { data: thread } = await supabaseAdmin
    .from("email_threads")
    .select("*")
    .eq("user_id", userId)
    .eq("gmail_thread_id", gmailThreadId)
    .maybeSingle();

  if (!thread) {
    const ins = await supabaseAdmin
      .from("email_threads")
      .insert({
        user_id: userId,
        gmail_thread_id: gmailThreadId,
        client_email: parts.fromEmail,
        client_name: parts.fromName || parts.fromEmail,
        subject: parts.subject,
        status: "analyzing",
        last_message_at: new Date().toISOString(),
      })
      .select()
      .single();
    thread = ins.data!;
  }

  // Skip if message already saved
  const { data: existing } = await supabaseAdmin
    .from("email_messages")
    .select("id")
    .eq("thread_id", thread.id)
    .eq("gmail_message_id", gmailMessage.id)
    .maybeSingle();
  if (existing) return { skipped: "already_processed" };

  // Save inbound
  await supabaseAdmin.from("email_messages").insert({
    thread_id: thread.id,
    user_id: userId,
    gmail_message_id: gmailMessage.id,
    direction: "inbound",
    from_email: parts.fromEmail,
    to_email: parts.to,
    subject: parts.subject,
    body: parts.body,
    sent_at: parts.date ? new Date(parts.date).toISOString() : new Date().toISOString(),
  });
  await logActivity(userId, "email_received", `Email reçu de ${parts.fromName || parts.fromEmail}`, parts.subject, thread.id);

  // Build history
  const { data: history } = await supabaseAdmin
    .from("email_messages")
    .select("direction,body,subject")
    .eq("thread_id", thread.id)
    .order("sent_at", { ascending: true });
  const historyForAI =
    (history ?? []).map((m) => ({
      role: m.direction === "inbound" ? ("user" as const) : ("assistant" as const),
      content: `${m.subject ?? ""}\n${m.body ?? ""}`,
    })) ?? [];

  // Analyze
  const analysis = await analyzeEmailWithAI({
    body: parts.body,
    subject: parts.subject,
    history: historyForAI,
    language: settings.language,
    nowIso: new Date().toISOString(),
    timezone: settings.timezone,
  });
  await logActivity(
    userId,
    "analysis",
    analysis.is_appointment_request ? "Demande de rendez-vous détectée" : "Email analysé (pas un RDV)",
    analysis.summary,
    thread.id,
    analysis,
  );

  if (!analysis.is_appointment_request) {
    await supabaseAdmin
      .from("email_threads")
      .update({ status: "not_appointment", ai_summary: analysis.summary, last_message_at: new Date().toISOString() })
      .eq("id", thread.id);
    return { handled: false, reason: "not_appointment" };
  }

  // Confirmation flow
  if (analysis.intent === "confirm") {
    // Find latest proposed appointment for this thread
    const { data: pending } = await supabaseAdmin
      .from("appointments")
      .select("*")
      .eq("thread_id", thread.id)
      .eq("status", "proposed")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (pending) {
      const accessToken = await getValidAccessToken(userId);
      const ev = await createCalendarEvent(accessToken, settings.calendar_id, {
        summary: `RDV avec ${thread.client_name || parts.fromEmail}`,
        description: `Confirmé via Agent IA.\n\n${analysis.summary}`,
        start: { dateTime: pending.scheduled_at, timeZone: settings.timezone },
        end: {
          dateTime: new Date(new Date(pending.scheduled_at).getTime() + pending.duration_minutes * 60_000).toISOString(),
          timeZone: settings.timezone,
        },
        attendees: [{ email: parts.fromEmail, displayName: thread.client_name ?? undefined }],
      });
      await supabaseAdmin
        .from("appointments")
        .update({ status: "confirmed", calendar_event_id: ev.id })
        .eq("id", pending.id);
      await supabaseAdmin.from("email_threads").update({ status: "confirmed" }).eq("id", thread.id);
      await logActivity(userId, "appointment_created", "Rendez-vous confirmé et ajouté au calendrier", undefined, thread.id, { eventId: ev.id });

      const reply = await craftReplyWithAI({
        persona: settings.agent_persona ?? "",
        language: settings.language,
        clientName: thread.client_name || "",
        signature: settings.signature ?? "",
        context: historyForAI.map((m) => `${m.role}: ${m.content}`).join("\n"),
        proposalType: "confirm_booked",
        requestedSlot: { start: pending.scheduled_at, end: pending.scheduled_at },
        timezone: settings.timezone,
      });
      await sendAndLog(userId, thread, parts, reply.subject, reply.body, settings.auto_send);
      return { handled: true, booked: true };
    }
  }

  // Check calendar
  const accessToken = await getValidAccessToken(userId);
  const requested = analysis.requested_datetimes_iso[0];
  const dur = analysis.duration_minutes ?? settings.appointment_duration_minutes;

  let proposalType: "slot_available" | "slot_taken_alternatives" | "need_more_info" = "need_more_info";
  let alternatives: { start: string; end: string }[] = [];
  let requestedSlot: { start: string; end: string } | undefined;
  let proposedAppointment: { scheduled_at: string; duration_minutes: number } | null = null;

  if (requested) {
    const start = new Date(requested);
    const end = new Date(start.getTime() + dur * 60_000);
    const busy = await getFreeBusy(
      accessToken,
      settings.calendar_id,
      new Date(start.getTime() - 3600_000).toISOString(),
      new Date(end.getTime() + 3600_000).toISOString(),
      settings.timezone,
    );
    const conflict = busy.some((b) => {
      const bs = new Date(b.start).getTime();
      const be = new Date(b.end).getTime();
      return start.getTime() < be && end.getTime() > bs;
    });
    await logActivity(userId, "calendar_check", conflict ? "Créneau occupé" : "Créneau libre", `Demandé: ${start.toISOString()}`, thread.id);
    requestedSlot = { start: start.toISOString(), end: end.toISOString() };
    if (!conflict && isWithinWorkingHours(start, settings.working_hours_start, settings.working_hours_end, settings.working_days, settings.timezone)) {
      proposalType = "slot_available";
      proposedAppointment = { scheduled_at: start.toISOString(), duration_minutes: dur };
    } else {
      proposalType = "slot_taken_alternatives";
      const widerBusy = await getFreeBusy(
        accessToken,
        settings.calendar_id,
        new Date().toISOString(),
        new Date(Date.now() + 14 * 86400_000).toISOString(),
        settings.timezone,
      );
      alternatives = suggestAlternativeSlots(widerBusy, settings, new Date(), 3);
      if (alternatives[0]) proposedAppointment = { scheduled_at: alternatives[0].start, duration_minutes: dur };
    }
  } else {
    // No datetime — offer alternatives proactively
    const widerBusy = await getFreeBusy(
      accessToken,
      settings.calendar_id,
      new Date().toISOString(),
      new Date(Date.now() + 14 * 86400_000).toISOString(),
      settings.timezone,
    );
    alternatives = suggestAlternativeSlots(widerBusy, settings, new Date(), 3);
    proposalType = alternatives.length ? "slot_taken_alternatives" : "need_more_info";
    if (alternatives[0]) proposedAppointment = { scheduled_at: alternatives[0].start, duration_minutes: dur };
  }

  // Save proposed appointment
  if (proposedAppointment) {
    await supabaseAdmin.from("appointments").insert({
      user_id: userId,
      thread_id: thread.id,
      client_email: parts.fromEmail,
      client_name: thread.client_name,
      scheduled_at: proposedAppointment.scheduled_at,
      duration_minutes: proposedAppointment.duration_minutes,
      status: "proposed",
    });
  }

  // Craft + send reply
  const reply = await craftReplyWithAI({
    persona: settings.agent_persona ?? "",
    language: settings.language,
    clientName: thread.client_name || "",
    signature: settings.signature ?? "",
    context: historyForAI.map((m) => `${m.role}: ${m.content}`).join("\n"),
    proposalType,
    slotsToOffer: alternatives,
    requestedSlot,
    questions: analysis.questions_for_agent,
    timezone: settings.timezone,
  });

  await supabaseAdmin
    .from("email_threads")
    .update({ status: "awaiting_client", ai_summary: analysis.summary, last_message_at: new Date().toISOString() })
    .eq("id", thread.id);

  await sendAndLog(userId, thread, parts, reply.subject, reply.body, settings.auto_send);
  return { handled: true, proposalType };
}

async function sendAndLog(userId: string, thread: any, parts: any, subject: string, body: string, autoSend: boolean) {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const replySubject = subject.toLowerCase().startsWith("re:") ? subject : `Re: ${parts.subject || ""}`;
  if (autoSend) {
    const accessToken = await getValidAccessToken(userId);
    try {
      await sendGmailReply(accessToken, {
        to: parts.fromEmail,
        subject: replySubject,
        body,
        threadId: thread.gmail_thread_id,
        inReplyToMessageId: parts.messageId || undefined,
        references: parts.references || undefined,
      });
      await logActivity(userId, "reply_sent", `Réponse envoyée à ${parts.fromEmail}`, replySubject, thread.id);
    } catch (e: any) {
      await logActivity(userId, "error", "Échec d'envoi", String(e?.message ?? e), thread.id);
    }
  }
  await supabaseAdmin.from("email_messages").insert({
    thread_id: thread.id,
    user_id: userId,
    direction: "outbound",
    from_email: parts.to,
    to_email: parts.fromEmail,
    subject: replySubject,
    body,
    sent_at: new Date().toISOString(),
  });
}

export async function runAgentForUser(userId: string) {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data: conn } = await supabaseAdmin.from("google_connections").select("*").eq("user_id", userId).maybeSingle();
  if (!conn) return { processed: 0, skipped: "no_google_connection" };
  const accessToken = await getValidAccessToken(userId);
  const after = conn.last_poll_at ? Math.floor(new Date(conn.last_poll_at).getTime() / 1000) : Math.floor(Date.now() / 1000) - 86400;
  const list = await listRecentMessages(accessToken, after, 15);
  let processed = 0;
  for (const m of list.messages ?? []) {
    try {
      const full = await getGmailMessage(accessToken, m.id);
      const res = await processIncomingMessage(userId, full);
      if (res && (res as any).handled) processed++;
    } catch (e: any) {
      await logActivity(userId, "error", "Erreur de traitement", String(e?.message ?? e));
    }
  }
  await supabaseAdmin.from("google_connections").update({ last_poll_at: new Date().toISOString() }).eq("user_id", userId);
  return { processed, total: list.messages?.length ?? 0 };
}
