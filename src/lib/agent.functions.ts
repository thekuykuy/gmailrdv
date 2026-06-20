import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { AGENT_AI_MODEL_VALUES } from "@/lib/ai-models";

export const runAgentNow = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { runAgentForUser } = await import("./agent.server");
    return runAgentForUser(context.userId);
  });

export const disconnectGoogle = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    await supabaseAdmin.from("google_connections").delete().eq("user_id", context.userId);
    return { ok: true };
  });

export const updateSettings = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        agent_enabled: z.boolean().optional(),
        auto_send: z.boolean().optional(),
        timezone: z.string().optional(),
        working_days: z.array(z.number().min(0).max(6)).optional(),
        working_hours_start: z.string().regex(/^\d{2}:\d{2}$/).optional(),
        working_hours_end: z.string().regex(/^\d{2}:\d{2}$/).optional(),
        appointment_duration_minutes: z.number().min(10).max(480).optional(),
        buffer_minutes: z.number().min(0).max(120).optional(),
        language: z.string().min(2).max(5).optional(),
        signature: z.string().max(2000).optional(),
        agent_persona: z.string().max(2000).optional(),
        calendar_id: z.string().max(255).optional(),
        ai_model: z.enum(AGENT_AI_MODEL_VALUES).optional(),
        cron_interval_minutes: z.number().int().min(1).max(60).optional(),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { error } = await supabase.from("agent_settings").update(data).eq("user_id", userId);
    if (error) throw new Error(error.message);
    if (typeof data.cron_interval_minutes === "number") {
      const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
      const { error: cronErr } = await supabaseAdmin.rpc("update_poll_cron_interval", { _minutes: data.cron_interval_minutes });
      if (cronErr) console.error("[updateSettings] cron reschedule failed", cronErr);
    }
    return { ok: true };
  });

export const getAiUsageStats = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z.object({ days: z.number().min(1).max(180).default(30) }).parse(d ?? {}),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const since = new Date(Date.now() - data.days * 86400_000).toISOString();
    const { data: rows, error } = await supabase
      .from("ai_usage_logs")
      .select("model, operation, prompt_tokens, completion_tokens, total_tokens, estimated_cost_usd, latency_ms, success, created_at")
      .eq("user_id", userId)
      .gte("created_at", since)
      .order("created_at", { ascending: false })
      .limit(2000);
    if (error) throw new Error(error.message);
    return { rows: rows ?? [], windowDays: data.days };
  });

export const deleteAppointment = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { data: appt } = await supabase.from("appointments").select("*").eq("id", data.id).eq("user_id", userId).maybeSingle();
    if (!appt) throw new Error("Rendez-vous introuvable");
    if (appt.status === "confirmed" && appt.calendar_event_id) {
      try {
        const { getValidAccessToken, deleteCalendarEvent } = await import("./google.server");
        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const { data: settings } = await supabaseAdmin.from("agent_settings").select("calendar_id").eq("user_id", userId).maybeSingle();
        const token = await getValidAccessToken(userId);
        await deleteCalendarEvent(token, settings?.calendar_id ?? "primary", appt.calendar_event_id);
      } catch (e) { console.error("[deleteAppointment] calendar delete failed", e); }
    }
    const { error } = await supabase.from("appointments").delete().eq("id", data.id).eq("user_id", userId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const deleteAllAppointments = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    const { data: confirmed } = await supabase
      .from("appointments")
      .select("calendar_event_id")
      .eq("user_id", userId)
      .eq("status", "confirmed")
      .not("calendar_event_id", "is", null);
    if (confirmed && confirmed.length) {
      try {
        const { getValidAccessToken, deleteCalendarEvent } = await import("./google.server");
        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const { data: settings } = await supabaseAdmin.from("agent_settings").select("calendar_id").eq("user_id", userId).maybeSingle();
        const token = await getValidAccessToken(userId);
        for (const a of confirmed) {
          try { await deleteCalendarEvent(token, settings?.calendar_id ?? "primary", a.calendar_event_id!); } catch {}
        }
      } catch (e) { console.error("[deleteAllAppointments] calendar cleanup failed", e); }
    }
    const { error } = await supabase.from("appointments").delete().eq("user_id", userId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const resetAgentData = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { userId } = context;
    try {
      const { data: confirmed } = await supabaseAdmin
        .from("appointments")
        .select("calendar_event_id")
        .eq("user_id", userId)
        .eq("status", "confirmed")
        .not("calendar_event_id", "is", null);
      if (confirmed?.length) {
        const { getValidAccessToken, deleteCalendarEvent } = await import("./google.server");
        const { data: settings } = await supabaseAdmin.from("agent_settings").select("calendar_id").eq("user_id", userId).maybeSingle();
        const token = await getValidAccessToken(userId);
        for (const a of confirmed) {
          try { await deleteCalendarEvent(token, settings?.calendar_id ?? "primary", a.calendar_event_id!); } catch {}
        }
      }
    } catch (e) { console.error("[resetAgentData] calendar cleanup failed", e); }

    await supabaseAdmin.from("ai_usage_logs").delete().eq("user_id", userId);
    await supabaseAdmin.from("appointments").delete().eq("user_id", userId);
    await supabaseAdmin.from("activity_logs").delete().eq("user_id", userId);
    await supabaseAdmin.from("email_messages").delete().eq("user_id", userId);
    await supabaseAdmin.from("email_threads").delete().eq("user_id", userId);
    await supabaseAdmin.from("google_connections").update({ last_poll_at: null, processing_lock_until: null }).eq("user_id", userId);
    return { ok: true };
  });
