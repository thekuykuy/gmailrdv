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
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { error } = await supabase.from("agent_settings").update(data).eq("user_id", userId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });
