/**
 * Core autonomous agent — runs per user, polls Gmail, analyzes via Lovable AI,
 * checks Calendar, replies, and logs activity.
 */
import { generateText } from "ai";
import { z } from "zod";
import { createLovableAiGatewayProvider } from "./ai-gateway.server";
import { normalizeAgentAiModel } from "./ai-models";
import { estimateCostUsd } from "./ai-pricing";
import {
  createCalendarEvent,
  deleteCalendarEvent,
  extractEmailParts,
  getFreeBusy,
  getGmailMessage,
  getValidAccessToken,
  listRecentMessages,
  sendGmailReply,
} from "./google.server";

function getAI(aiModel?: string | null) {
  const key = process.env.LOVABLE_API_KEY;
  if (!key) throw new Error("Missing LOVABLE_API_KEY");
  return createLovableAiGatewayProvider(key)(normalizeAgentAiModel(aiModel));
}

async function logAiUsage(opts: {
  userId?: string;
  model: string;
  operation: string;
  usage?: { promptTokens?: number; completionTokens?: number; totalTokens?: number } | null;
  latencyMs: number;
  success: boolean;
  error?: string;
}) {
  if (!opts.userId) return;
  try {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const prompt = opts.usage?.promptTokens ?? 0;
    const completion = opts.usage?.completionTokens ?? 0;
    const total = opts.usage?.totalTokens ?? prompt + completion;
    await supabaseAdmin.from("ai_usage_logs").insert({
      user_id: opts.userId,
      model: opts.model,
      operation: opts.operation,
      prompt_tokens: prompt,
      completion_tokens: completion,
      total_tokens: total,
      estimated_cost_usd: estimateCostUsd(opts.model, prompt, completion),
      latency_ms: opts.latencyMs,
      success: opts.success,
      error: opts.error ?? null,
    });
  } catch (e) {
    console.error("[logAiUsage] failed", e);
  }
}

async function runAiCall(opts: { aiModel?: string | null; userId?: string; operation: string; prompt: string }) {
  const modelName = normalizeAgentAiModel(opts.aiModel);
  const model = getAI(opts.aiModel);
  const started = Date.now();
  try {
    const result = await generateText({ model, prompt: opts.prompt });
    await logAiUsage({
      userId: opts.userId,
      model: modelName,
      operation: opts.operation,
      usage: result.usage as any,
      latencyMs: Date.now() - started,
      success: true,
    });
    return result;
  } catch (e: any) {
    await logAiUsage({
      userId: opts.userId,
      model: modelName,
      operation: opts.operation,
      latencyMs: Date.now() - started,
      success: false,
      error: e?.message?.slice(0, 500),
    });
    throw e;
  }
}

const AnalysisSchema = z.object({
  is_appointment_request: z.boolean(),
  client_name: z.string().default(""),
  intent: z.enum(["new_request", "confirm", "decline", "reschedule", "info_only", "other"]),
  requested_datetimes_iso: z.array(z.string()).default([]),
  duration_minutes: z.number().default(0),
  summary: z.string().default(""),
  questions_for_agent: z.array(z.string()).default([]),
});

export type Analysis = z.infer<typeof AnalysisSchema>;

function extractJson(text: string): any {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const raw = fenced ? fenced[1] : text;
  const first = raw.indexOf("{");
  const last = raw.lastIndexOf("}");
  if (first === -1 || last === -1) throw new Error("no JSON in response");
  return JSON.parse(raw.slice(first, last + 1));
}

function isExplicitAppointmentConfirmation(text: string) {
  const normalized = text.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  const hasConfirmation = /\b(je confirme|confirme|confirmation|oui|ok|d'accord|parfait|c'est bon|ca marche|ca me va|me convient|cela me convient|je prends|valid[eé]|allons-y)\b/.test(normalized);
  const isOnlyNewRequest = /\b(je voudrais|j'aimerais|je souhaite|pouvez-vous|serait-il possible|demande de rendez-vous|prendre rendez-vous)\b/.test(normalized) && !/\b(je confirme|confirme|oui|ok|d'accord|parfait|valid[eé])\b/.test(normalized);
  return hasConfirmation && !isOnlyNewRequest;
}

function makeGoogleCalendarEventId(appointmentId: string) {
  return `agent${appointmentId.replace(/-/g, "")}`;
}

function findMatchingPendingAppointment(pending: any[], selectedSlotIso?: string) {
  if (!pending.length) return null;
  if (!selectedSlotIso) return pending.length === 1 ? pending[0] : null;
  const selected = new Date(selectedSlotIso).getTime();
  return pending.find((p) => Math.abs(new Date(p.scheduled_at).getTime() - selected) <= 15 * 60_000) ?? null;
}

function isCalendarAlreadyExistsError(error: unknown) {
  return typeof error === "object" && error !== null && "status" in error && (error as { status?: number }).status === 409;
}

export async function analyzeEmailWithAI(opts: {
  body: string;
  subject: string;
  history: { role: "user" | "assistant"; content: string }[];
  language: string;
  nowIso: string;
  timezone: string;
  aiModel?: string | null;
  userId?: string;
}): Promise<Analysis> {
  const prompt = `Tu es un classificateur d'emails. Date actuelle: ${opts.nowIso} (${opts.timezone}). Langue: ${opts.language}.

Historique de la conversation:
${opts.history.map((m) => `${m.role.toUpperCase()}: ${m.content}`).join("\n---\n") || "(aucun)"}

NOUVEL EMAIL:
Sujet: ${opts.subject}
Corps:
${opts.body}

RÈGLES STRICTES pour "intent":
- "confirm" UNIQUEMENT si l'ASSISTANT a déjà proposé un créneau précis dans l'historique ET que le client accepte explicitement CE créneau (ex: "oui je confirme", "c'est parfait pour ce créneau", "ok pour mardi 10h").
- Une PREMIÈRE demande de rendez-vous n'est JAMAIS "confirm", même si le client écrit "je confirme vouloir un rendez-vous" — c'est "new_request".
- S'il n'y a AUCUN message de l'assistant dans l'historique, intent ne peut pas être "confirm".

Réponds UNIQUEMENT avec un objet JSON valide (aucun texte avant/après, pas de markdown), avec EXACTEMENT cette structure:
{
  "is_appointment_request": boolean,        // true si demande de RDV/réunion/appel
  "client_name": string,                    // nom du client si déductible, sinon ""
  "intent": "new_request" | "confirm" | "decline" | "reschedule" | "info_only" | "other",
  "requested_datetimes_iso": string[],      // créneaux mentionnés en ISO 8601 absolu (utilise la date actuelle comme référence). Vide si aucun.
  "duration_minutes": number,               // durée demandée en minutes, 0 si non précisée
  "summary": string,                        // résumé en une phrase
  "questions_for_agent": string[]           // infos manquantes à clarifier
}`;

  try {
    const { text } = await runAiCall({ aiModel: opts.aiModel, userId: opts.userId, operation: "analyze_email", prompt });
    const parsed = AnalysisSchema.parse(extractJson(text));
    return parsed;
  } catch (e) {
    console.error("[analyzeEmailWithAI] parse failed", e);
    return {
      is_appointment_request: false,
      client_name: "",
      intent: "other",
      requested_datetimes_iso: [],
      duration_minutes: 0,
      summary: "Analyse impossible — email ignoré.",
      questions_for_agent: [],
    };
  }
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
  aiModel?: string | null;
  userId?: string;
  skipGreeting?: boolean;
}) {
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

  const greetingRule = opts.skipGreeting
    ? `RÈGLE IMPORTANTE: tu as DÉJÀ écrit au client aujourd'hui dans ce même fil. Ne recommence PAS par "Bonjour", "Bonsoir", "Salut" ni aucune formule de salutation. Enchaîne directement avec ta réponse (par ex. "Voici…", "Comme convenu…", "Très bien,…").`
    : `Tu peux ouvrir par une salutation courtoise ("Bonjour ${opts.clientName || ""}", etc.) car c'est ton premier message du jour dans ce fil.`;

  const prompt = `${opts.persona}
Langue: ${opts.language}. Client: ${opts.clientName || "le client"}.
Objectif: ${intent}
${greetingRule}
${reqBlock}
${slotsBlock}
${questionsBlock}
Contexte conversation:
${opts.context}

Génère un email professionnel, concis, naturel. Termine avec cette signature:
---
${opts.signature || ""}

Réponds UNIQUEMENT avec un objet JSON valide (aucun texte avant/après, pas de markdown), avec EXACTEMENT cette structure:
{
  "subject": string,
  "body": string
}`;


  try {
    const { text } = await runAiCall({ aiModel: opts.aiModel, userId: opts.userId, operation: `craft_reply:${opts.proposalType}`, prompt });
    const obj = extractJson(text);
    return {
      subject: String(obj.subject ?? "Re: votre demande"),
      body: String(obj.body ?? text),
    };
  } catch (e) {
    console.error("[craftReplyWithAI] parse failed", e);
    const { text } = await runAiCall({
      aiModel: opts.aiModel,
      userId: opts.userId,
      operation: `craft_reply_fallback:${opts.proposalType}`,
      prompt: prompt.replace(/Réponds UNIQUEMENT[\s\S]*$/, "Écris seulement le corps de l'email."),
    });
    return { subject: "Re: votre demande", body: text };
  }
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

function appointmentFitsWorkingHours(date: Date, durationMinutes: number, settings: { working_days: number[]; working_hours_start: string; working_hours_end: string; timezone: string }) {
  const end = new Date(date.getTime() + Math.max(durationMinutes, 1) * 60_000 - 60_000);
  return (
    isWithinWorkingHours(date, settings.working_hours_start, settings.working_hours_end, settings.working_days, settings.timezone) &&
    isWithinWorkingHours(end, settings.working_hours_start, settings.working_hours_end, settings.working_days, settings.timezone)
  );
}

export function suggestAlternativeSlots(
  busy: { start: string; end: string }[],
  settings: { working_days: number[]; working_hours_start: string; working_hours_end: string; appointment_duration_minutes: number; buffer_minutes: number; timezone: string },
  fromDate: Date,
  count = 3,
) {
  const candidates: { slot: { start: string; end: string }; score: number }[] = [];
  const dur = settings.appointment_duration_minutes;
  const stepMin = Math.max(30, settings.buffer_minutes || 0);
  const now = new Date(Date.now() + 30 * 60_000);
  const anchor = fromDate.getTime() > now.getTime() ? fromDate : now;
  const cursor = new Date(anchor);
  cursor.setMinutes(Math.ceil(cursor.getMinutes() / 30) * 30, 0, 0);
  const limit = new Date(anchor.getTime() + 14 * 86400_000);
  const anchorMinutes = getMinutesInTimezone(anchor, settings.timezone);

  while (cursor < limit) {
    if (
      appointmentFitsWorkingHours(cursor, dur, settings)
    ) {
      const end = new Date(cursor.getTime() + dur * 60_000);
      const isBusy = busy.some((b) => {
        const bs = new Date(b.start).getTime();
        const be = new Date(b.end).getTime();
        return cursor.getTime() < be && end.getTime() > bs;
      });
      if (!isBusy) {
        const dayDistance = Math.floor(Math.max(0, cursor.getTime() - anchor.getTime()) / 86400_000);
        const timeDistance = Math.abs(getMinutesInTimezone(cursor, settings.timezone) - anchorMinutes);
        candidates.push({ slot: { start: cursor.toISOString(), end: end.toISOString() }, score: dayDistance * 600 + timeDistance });
      }
    }
    cursor.setMinutes(cursor.getMinutes() + stepMin);
  }
  return candidates
    .sort((a, b) => a.score - b.score || new Date(a.slot.start).getTime() - new Date(b.slot.start).getTime())
    .slice(0, count)
    .map((c) => c.slot);
}

function getMinutesInTimezone(date: Date, tz: string) {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: tz, hour: "numeric", minute: "numeric", hour12: false }).formatToParts(date);
  return Number(parts.find((p) => p.type === "hour")?.value ?? "0") * 60 + Number(parts.find((p) => p.type === "minute")?.value ?? "0");
}

function overlapsSlot(busy: { start: string; end: string }[], start: Date, end: Date) {
  return busy.some((b) => {
    const bs = new Date(b.start).getTime();
    const be = new Date(b.end).getTime();
    return start.getTime() < be && end.getTime() > bs;
  });
}

async function getAppointmentBusy(
  supabaseAdmin: any,
  userId: string,
  start: Date,
  end: Date,
  statuses: string[],
  excludeId?: string,
  excludeThreadId?: string,
) {
  let query = supabaseAdmin
    .from("appointments")
    .select("id,thread_id,scheduled_at,duration_minutes")
    .eq("user_id", userId)
    .in("status", statuses)
    .gte("scheduled_at", new Date(start.getTime() - 24 * 3600_000).toISOString())
    .lte("scheduled_at", new Date(end.getTime() + 24 * 3600_000).toISOString());
  if (excludeId) query = query.neq("id", excludeId);
  if (excludeThreadId) query = query.neq("thread_id", excludeThreadId);
  const { data } = await query;
  return (data ?? []).map((a: any) => {
    const s = new Date(a.scheduled_at);
    return { start: s.toISOString(), end: new Date(s.getTime() + (a.duration_minutes ?? 30) * 60_000).toISOString() };
  });
}

async function getConfirmedAppointmentBusy(supabaseAdmin: any, userId: string, start: Date, end: Date, excludeId?: string) {
  return getAppointmentBusy(supabaseAdmin, userId, start, end, ["confirmed"], excludeId);
}

async function getProposedOrConfirmedBusy(supabaseAdmin: any, userId: string, start: Date, end: Date, excludeThreadId?: string) {
  return getAppointmentBusy(supabaseAdmin, userId, start, end, ["pending", "confirmed"], undefined, excludeThreadId);
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

  // Save inbound — the unique index (thread_id, gmail_message_id) makes this race-safe:
  // if two cron runs process the same message concurrently, only one insert succeeds.
  const { error: insertErr } = await supabaseAdmin.from("email_messages").insert({
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
  if (insertErr) {
    // Duplicate key = another run already owns this message. Never process twice.
    return { skipped: "duplicate_message" };
  }
  await logActivity(userId, "email_received", `Email reçu de ${parts.fromName || parts.fromEmail}`, parts.subject, thread.id);

  // Build history
  const { data: history } = await supabaseAdmin
    .from("email_messages")
    .select("direction,body,subject,sent_at")
    .eq("thread_id", thread.id)
    .order("sent_at", { ascending: true });
  const historyForAI =
    (history ?? []).map((m) => ({
      role: m.direction === "inbound" ? ("user" as const) : ("assistant" as const),
      content: `${m.subject ?? ""}\n${m.body ?? ""}`,
    })) ?? [];

  // Greeting rule: do not say "Bonjour" twice the same day in the same thread.
  const tz = settings.timezone || "Indian/Reunion";
  const dayKey = (iso: string) => new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(iso));
  const todayKey = dayKey(new Date().toISOString());
  const skipGreeting = (history ?? []).some((m) => m.direction === "outbound" && m.sent_at && dayKey(m.sent_at) === todayKey);


  // Analyze
  const analysis = await analyzeEmailWithAI({
    body: parts.body,
    subject: parts.subject,
    history: historyForAI,
    language: settings.language,
    nowIso: new Date().toISOString(),
    timezone: settings.timezone,
    aiModel: settings.ai_model,
      userId,
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

  // GUARD MÉTIER: une "confirmation" n'est valide que si l'agent a déjà
  // envoyé une proposition dans ce fil (au moins un message sortant).
  // Une première demande ne peut JAMAIS déclencher une création d'événement.
  const agentHasReplied = (history ?? []).some((m) => m.direction === "outbound");
  const hasExplicitConfirmation = isExplicitAppointmentConfirmation(`${parts.subject}\n${parts.body}`);
  const effectiveIntent = analysis.intent === "confirm" && agentHasReplied && hasExplicitConfirmation ? "confirm" : analysis.intent === "confirm" ? "new_request" : analysis.intent;
  if (analysis.intent === "confirm" && effectiveIntent !== "confirm") {
    await logActivity(userId, "analysis", "Intent 'confirm' rétrogradé en 'new_request' (confirmation client non explicite ou aucune proposition envoyée)", undefined, thread.id);
  }

  // Confirmation flow — SEUL endroit où un événement Google Calendar est créé
  if (effectiveIntent === "confirm") {
    // Idempotency: if this thread already has a confirmed appointment, skip booking
    const { data: alreadyConfirmed } = await supabaseAdmin
      .from("appointments")
      .select("id")
      .eq("thread_id", thread.id)
      .eq("status", "confirmed")
      .limit(1)
      .maybeSingle();

    // Find the pending slot the client confirmed. If several alternatives were
    // proposed, only book the matching one; otherwise ask again instead of guessing.
    const { data: pendingRows } = await supabaseAdmin
      .from("appointments")
      .select("*")
      .eq("thread_id", thread.id)
      .eq("status", "pending")
      .order("created_at", { ascending: false });
    const selectedSlotIso = analysis.requested_datetimes_iso[0];
    const pending = findMatchingPendingAppointment(pendingRows ?? [], selectedSlotIso);

    if (pending && !alreadyConfirmed) {
      const accessToken = await getValidAccessToken(userId);
      const selectedDuration = analysis.duration_minutes > 0 ? analysis.duration_minutes : pending.duration_minutes;
      const slotStart = new Date(selectedSlotIso || pending.scheduled_at);
      const slotEnd = new Date(slotStart.getTime() + selectedDuration * 60_000);

      // RÈGLE: un créneau = un seul rendez-vous. Re-vérifier la disponibilité
      // (calendrier Google + RDV confirmés en base) juste avant de réserver.
      const busyNow = await getFreeBusy(
        accessToken,
        settings.calendar_id,
        new Date(slotStart.getTime() - 3600_000).toISOString(),
        new Date(slotEnd.getTime() + 3600_000).toISOString(),
        settings.timezone,
      );
      const calendarConflict = overlapsSlot(busyNow, slotStart, slotEnd);
      const dbBusy = await getConfirmedAppointmentBusy(supabaseAdmin, userId, slotStart, slotEnd, pending.id);
      const dbConflict = overlapsSlot(dbBusy, slotStart, slotEnd);

      if (calendarConflict || dbConflict) {
        // Le créneau a été pris entre-temps — annuler la proposition et
        // proposer des alternatives au lieu de réserver en double.
        await supabaseAdmin.from("appointments").update({ status: "cancelled" }).eq("thread_id", thread.id).eq("status", "pending");
        await logActivity(userId, "calendar_check", "Conflit détecté à la confirmation — créneau déjà pris", `Créneau: ${slotStart.toISOString()}`, thread.id);

        const widerBusy = await getFreeBusy(
          accessToken,
          settings.calendar_id,
          new Date().toISOString(),
          new Date(Date.now() + 14 * 86400_000).toISOString(),
          settings.timezone,
        );
        const proposedBusy = await getProposedOrConfirmedBusy(supabaseAdmin, userId, new Date(), new Date(Date.now() + 14 * 86400_000), thread.id);
        const alts = suggestAlternativeSlots([...widerBusy, ...proposedBusy], settings, slotStart, 3);
        if (alts.length) {
          await supabaseAdmin.from("appointments").insert(alts.map((alt) => ({
            user_id: userId,
            thread_id: thread.id,
            client_email: parts.fromEmail,
            client_name: thread.client_name,
            scheduled_at: alt.start,
            duration_minutes: selectedDuration,
            status: "pending",
          })));
        }
        const conflictReply = await craftReplyWithAI({
          persona: settings.agent_persona ?? "",
          language: settings.language,
          clientName: thread.client_name || "",
          signature: settings.signature ?? "",
          context: historyForAI.map((m) => `${m.role}: ${m.content}`).join("\n"),
          proposalType: "slot_taken_alternatives",
          slotsToOffer: alts,
          requestedSlot: { start: slotStart.toISOString(), end: slotEnd.toISOString() },
          timezone: settings.timezone,
          aiModel: settings.ai_model,
      userId,
        });
        await supabaseAdmin
          .from("email_threads")
          .update({ status: "awaiting_client", last_message_at: new Date().toISOString() })
          .eq("id", thread.id);
        await sendAndLog(userId, thread, parts, conflictReply.subject, conflictReply.body, settings.auto_send);
        return { handled: true, conflict: true };
      }

      const eventId = makeGoogleCalendarEventId(pending.id);
      const { error: confirmError } = await supabaseAdmin
        .from("appointments")
        .update({ status: "confirmed", scheduled_at: slotStart.toISOString(), duration_minutes: selectedDuration })
        .eq("id", pending.id)
        .eq("status", "pending");
      if (confirmError) {
        await logActivity(userId, "calendar_check", "Conflit détecté pendant le verrouillage du rendez-vous", confirmError.message, thread.id);
        await supabaseAdmin.from("appointments").update({ status: "cancelled" }).eq("thread_id", thread.id).eq("status", "pending");
        const widerBusy = await getFreeBusy(
          accessToken,
          settings.calendar_id,
          new Date().toISOString(),
          new Date(Date.now() + 14 * 86400_000).toISOString(),
          settings.timezone,
        );
        const proposedBusy = await getProposedOrConfirmedBusy(supabaseAdmin, userId, new Date(), new Date(Date.now() + 14 * 86400_000), thread.id);
        const alts = suggestAlternativeSlots([...widerBusy, ...proposedBusy], settings, slotStart, 3);
        if (alts.length) {
          await supabaseAdmin.from("appointments").insert(alts.map((alt) => ({
            user_id: userId,
            thread_id: thread.id,
            client_email: parts.fromEmail,
            client_name: thread.client_name,
            scheduled_at: alt.start,
            duration_minutes: selectedDuration,
            status: "pending",
          })));
        }
        const conflictReply = await craftReplyWithAI({
          persona: settings.agent_persona ?? "",
          language: settings.language,
          clientName: thread.client_name || "",
          signature: settings.signature ?? "",
          context: historyForAI.map((m) => `${m.role}: ${m.content}`).join("\n"),
          proposalType: "slot_taken_alternatives",
          slotsToOffer: alts,
          requestedSlot: { start: slotStart.toISOString(), end: slotEnd.toISOString() },
          timezone: settings.timezone,
          aiModel: settings.ai_model,
      userId,
        });
        await supabaseAdmin.from("email_threads").update({ status: "awaiting_client", last_message_at: new Date().toISOString() }).eq("id", thread.id);
        await sendAndLog(userId, thread, parts, conflictReply.subject, conflictReply.body, settings.auto_send);
        return { handled: true, conflict: true, skipped: "confirmation_race_lost" };
      }
      const { data: confirmedRow } = await supabaseAdmin
        .from("appointments")
        .select("id")
        .eq("id", pending.id)
        .eq("status", "confirmed")
        .maybeSingle();
      if (!confirmedRow) {
        await logActivity(userId, "calendar_check", "Confirmation ignorée — le créneau n'est plus en attente", undefined, thread.id);
        return { handled: true, skipped: "confirmation_race_lost" };
      }
      let ev: { id?: string } = { id: eventId };
      try {
        ev = await createCalendarEvent(accessToken, settings.calendar_id, {
          id: eventId,
          summary: `RDV avec ${thread.client_name || parts.fromEmail}`,
          description: `Confirmé via Agent IA.\n\n${analysis.summary}`,
          start: { dateTime: slotStart.toISOString(), timeZone: settings.timezone },
          end: { dateTime: slotEnd.toISOString(), timeZone: settings.timezone },
          attendees: [{ email: parts.fromEmail, displayName: thread.client_name ?? undefined }],
        });
      } catch (error) {
        if (!isCalendarAlreadyExistsError(error)) {
          await supabaseAdmin.from("appointments").update({ status: "cancelled" }).eq("id", pending.id);
          throw error;
        }
      }
      await supabaseAdmin.from("appointments").update({ calendar_event_id: ev.id ?? eventId }).eq("id", pending.id);
      // Annuler toute autre demande restante du fil — un seul RDV par fil
      await supabaseAdmin
        .from("appointments")
        .update({ status: "cancelled" })
        .eq("thread_id", thread.id)
        .eq("status", "pending");
      await supabaseAdmin.from("email_threads").update({ status: "confirmed" }).eq("id", thread.id);
      await logActivity(userId, "appointment_created", "Rendez-vous confirmé et ajouté au calendrier", undefined, thread.id, { eventId: ev.id });

      const reply = await craftReplyWithAI({
        persona: settings.agent_persona ?? "",
        language: settings.language,
        clientName: thread.client_name || "",
        signature: settings.signature ?? "",
        context: historyForAI.map((m) => `${m.role}: ${m.content}`).join("\n"),
        proposalType: "confirm_booked",
        requestedSlot: { start: slotStart.toISOString(), end: slotEnd.toISOString() },
        timezone: settings.timezone,
        aiModel: settings.ai_model,
      userId,
      });
      await sendAndLog(userId, thread, parts, reply.subject, reply.body, settings.auto_send);
      return { handled: true, booked: true };
    }

    if (alreadyConfirmed) {
      // Already booked — just acknowledge, never recreate
      await logActivity(userId, "analysis", "Confirmation reçue mais RDV déjà enregistré", undefined, thread.id);
      return { handled: true, skipped: "already_confirmed" };
    }
  }

  // Check calendar
  const accessToken = await getValidAccessToken(userId);
  const requested = analysis.requested_datetimes_iso[0];
  const dur = analysis.duration_minutes > 0 ? analysis.duration_minutes : settings.appointment_duration_minutes;

  let proposalType: "slot_available" | "slot_taken_alternatives" | "need_more_info" = "need_more_info";
  let alternatives: { start: string; end: string }[] = [];
  let requestedSlot: { start: string; end: string } | undefined;
  let pendingAppointments: { scheduled_at: string; duration_minutes: number }[] = [];

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
    const dbBusy = await getProposedOrConfirmedBusy(supabaseAdmin, userId, start, end, thread.id);
    const conflict = overlapsSlot([...busy, ...dbBusy], start, end);
    await logActivity(userId, "calendar_check", conflict ? "Créneau occupé" : "Créneau libre", `Demandé: ${start.toISOString()}`, thread.id);
    requestedSlot = { start: start.toISOString(), end: end.toISOString() };
    if (!conflict && appointmentFitsWorkingHours(start, dur, settings)) {
      proposalType = "slot_available";
      pendingAppointments = [{ scheduled_at: start.toISOString(), duration_minutes: dur }];
    } else {
      proposalType = "slot_taken_alternatives";
      const widerBusy = await getFreeBusy(
        accessToken,
        settings.calendar_id,
        new Date().toISOString(),
        new Date(Date.now() + 14 * 86400_000).toISOString(),
        settings.timezone,
      );
      const proposedBusy = await getProposedOrConfirmedBusy(supabaseAdmin, userId, new Date(), new Date(Date.now() + 14 * 86400_000), thread.id);
      alternatives = suggestAlternativeSlots([...widerBusy, ...proposedBusy], settings, start, 3);
      pendingAppointments = alternatives.map((alt) => ({ scheduled_at: alt.start, duration_minutes: dur }));
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
    const proposedBusy = await getProposedOrConfirmedBusy(supabaseAdmin, userId, new Date(), new Date(Date.now() + 14 * 86400_000), thread.id);
    alternatives = suggestAlternativeSlots([...widerBusy, ...proposedBusy], settings, new Date(), 3);
    proposalType = alternatives.length ? "slot_taken_alternatives" : "need_more_info";
    pendingAppointments = alternatives.map((alt) => ({ scheduled_at: alt.start, duration_minutes: dur }));
  }

  // Save pending appointment — AUCUN événement Google Calendar ici.
  // On garde une seule demande active par fil : les anciennes sont annulées.
  if (pendingAppointments.length) {
    await supabaseAdmin
      .from("appointments")
      .update({ status: "cancelled" })
      .eq("thread_id", thread.id)
      .eq("status", "pending");
    await supabaseAdmin.from("appointments").insert(pendingAppointments.map((pendingAppointment) => ({
      user_id: userId,
      thread_id: thread.id,
      client_email: parts.fromEmail,
      client_name: thread.client_name,
      scheduled_at: pendingAppointment.scheduled_at,
      duration_minutes: pendingAppointment.duration_minutes,
      status: "pending",
    })));
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
    aiModel: settings.ai_model,
      userId,
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
  const { data: lockClaimed } = await supabaseAdmin.rpc("claim_google_processing_lock", { _user_id: userId, _ttl_seconds: 300 });
  if (!lockClaimed) return { processed: 0, skipped: "agent_already_running" };
  try {
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
  } finally {
    await supabaseAdmin.rpc("release_google_processing_lock", { _user_id: userId });
  }
}
