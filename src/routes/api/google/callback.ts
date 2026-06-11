import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/google/callback")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const url = new URL(request.url);
        const code = url.searchParams.get("code");
        const userId = url.searchParams.get("state");
        const error = url.searchParams.get("error");
        if (error) return Response.redirect(`${url.origin}/dashboard?google_error=${encodeURIComponent(error)}`, 302);
        if (!code || !userId) return new Response("Missing code or state", { status: 400 });
        const { exchangeCodeForTokens, getUserInfo } = await import("@/lib/google.server");
        const redirectUri = `${url.origin}/api/google/callback`;
        try {
          const tokens = await exchangeCodeForTokens(code, redirectUri);
          if (!tokens.refresh_token) {
            return Response.redirect(`${url.origin}/dashboard?google_error=no_refresh_token`, 302);
          }
          const info = await getUserInfo(tokens.access_token);
          const expiresAt = new Date(Date.now() + tokens.expires_in * 1000).toISOString();
          const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
          await supabaseAdmin.from("google_connections").upsert(
            {
              user_id: userId,
              google_email: info.email,
              access_token: tokens.access_token,
              refresh_token: tokens.refresh_token,
              token_expires_at: expiresAt,
              scopes: tokens.scope,
              last_poll_at: new Date().toISOString(),
            },
            { onConflict: "user_id" },
          );
          await supabaseAdmin.from("activity_logs").insert({
            user_id: userId,
            type: "analysis",
            title: "Compte Google connecté",
            description: info.email,
          });
          return Response.redirect(`${url.origin}/dashboard?google=connected`, 302);
        } catch (e: any) {
          return Response.redirect(`${url.origin}/dashboard?google_error=${encodeURIComponent(String(e?.message ?? e))}`, 302);
        }
      },
    },
  },
});
