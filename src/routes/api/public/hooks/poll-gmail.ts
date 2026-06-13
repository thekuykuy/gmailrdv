import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/public/hooks/poll-gmail")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const expectedApiKey = process.env.SUPABASE_PUBLISHABLE_KEY || process.env.VITE_SUPABASE_PUBLISHABLE_KEY;
        const receivedApiKey = request.headers.get("apikey");
        if (!expectedApiKey || receivedApiKey !== expectedApiKey) {
          return Response.json({ ok: false, error: "Unauthorized" }, { status: 401 });
        }

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
