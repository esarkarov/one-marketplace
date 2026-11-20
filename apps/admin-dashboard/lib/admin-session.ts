export const SESSION_COOKIE = "admin_session";

export interface SessionCookieOptions {
  httpOnly: true;
  sameSite: "strict";
  secure: boolean;
  path: "/";
  maxAge: number;
}

export type SessionCookieResult =
  | { ok: true; name: string; value: string; options: SessionCookieOptions }
  | { ok: false };

export function buildSessionCookie({
  token,
  expiresAt,
  now = Date.now(),
  production,
}: {
  token: unknown;
  expiresAt: unknown;
  now?: number;
  production: boolean;
}): SessionCookieResult {
  if (typeof token !== "string" || token.length === 0) return { ok: false };
  if (typeof expiresAt !== "string") return { ok: false };

  const expiresAtMs = Date.parse(expiresAt);
  if (!Number.isFinite(expiresAtMs)) return { ok: false };

  const maxAge = Math.floor((expiresAtMs - now) / 1000);
  if (maxAge <= 0) return { ok: false };

  return {
    ok: true,
    name: SESSION_COOKIE,
    value: token,
    options: {
      httpOnly: true,
      sameSite: "strict",
      secure: production,
      path: "/",
      maxAge,
    },
  };
}

export function isSameOriginRequest(headers: Headers): boolean {
  const fetchSite = headers.get("sec-fetch-site");
  if (fetchSite !== null) return fetchSite === "same-origin";

  const origin = headers.get("origin");
  const host = headers.get("host");
  if (origin === null || host === null) return false;

  try {
    return new URL(origin).host === host;
  } catch {
    return false;
  }
}
