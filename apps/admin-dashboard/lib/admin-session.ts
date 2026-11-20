// Signed session tokens for the admin password gate. The cookie's mere
// presence is not enough to prove it — anyone can create a plain cookie with
// any name/value via document.cookie before ever logging in. Signing with a
// server-only secret (never sent to the browser) makes the token unforgeable:
// middleware recomputes the HMAC and rejects anything that doesn't match.

export const SESSION_COOKIE = "admin_session";
const SESSION_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

function toHex(buffer: ArrayBuffer): string {
  return Array.from(new Uint8Array(buffer))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

async function sign(secret: string, value: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(value),
  );
  return toHex(signature);
}

export async function createSessionToken(
  secret: string,
): Promise<{ token: string; maxAgeSeconds: number }> {
  const expiresAt = Date.now() + SESSION_TTL_MS;
  const signature = await sign(secret, String(expiresAt));
  return {
    token: `${expiresAt}.${signature}`,
    maxAgeSeconds: Math.floor(SESSION_TTL_MS / 1000),
  };
}

export async function verifySessionToken(
  token: string | undefined,
  secret: string,
): Promise<boolean> {
  if (!token) return false;
  const [expiresAtRaw, signature] = token.split(".");
  if (!expiresAtRaw || !signature) return false;

  const expiresAt = Number(expiresAtRaw);
  if (!Number.isFinite(expiresAt) || expiresAt < Date.now()) return false;

  const expected = await sign(secret, expiresAtRaw);
  return expected === signature;
}
