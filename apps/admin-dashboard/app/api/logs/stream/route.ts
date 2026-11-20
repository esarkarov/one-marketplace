import { cookies } from "next/headers";
import { SESSION_COOKIE } from "../../../../lib/admin-session";

// Proxies the backend's SSE log stream so the browser only ever talks to
// this app's own origin — the httpOnly session cookie never needs to leave
// it, and EventSource (which can't set custom headers) never needs the
// token directly.
export async function GET() {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;

  const upstream = await fetch(
    `${process.env.NEXT_PUBLIC_SERVER_URI}/admin/logs/stream`,
    {
      headers: token ? { Authorization: `Bearer ${token}` } : undefined,
      cache: "no-store",
    },
  );

  if (!upstream.ok || !upstream.body) {
    return new Response(
      JSON.stringify({ success: false, message: "Log stream unavailable." }),
      {
        status: upstream.status || 502,
        headers: { "Content-Type": "application/json" },
      },
    );
  }

  return new Response(upstream.body, {
    status: 200,
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
}
