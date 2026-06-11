import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/public/hooks/poll-gmail")({
  server: {
    handlers: {
      POST: async () => {
        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const { runAgentForUser } = await import("@/lib/agent.server");
        const { data: conns } = await supabaseAdmin.from("google_connections").select("user_id");
        const results: any[] = [];
        for (const c of conns ?? []) {
          try {
            const res = await runAgentForUser(c.user_id);
            results.push({ user_id: c.user_id, ...res });
          } catch (e: any) {
            results.push({ user_id: c.user_id, error: String(e?.message ?? e) });
          }
        }
        return Response.json({ ok: true, results });
      },
    },
  },
});
