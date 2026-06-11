import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/google/connect")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const { buildAuthUrl } = await import("@/lib/google.server");
        const url = new URL(request.url);
        const userId = url.searchParams.get("uid");
        if (!userId) return new Response("Missing uid", { status: 400 });
        const redirectUri = `${url.origin}/api/google/callback`;
        const authUrl = buildAuthUrl(redirectUri, userId);
        return Response.redirect(authUrl, 302);
      },
    },
  },
});
