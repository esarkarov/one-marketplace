import { createHmac, timingSafeEqual } from "crypto";
import { ADMIN_SESSION_TTL_MS } from "@/middleware/constants/admin-session.constants.js";

const sign = (expiresAtRaw: string, secret: string) =>
  createHmac("sha256", secret).update(expiresAtRaw).digest("hex");

export const signToken = (
  secret: string,
  now: number = Date.now(),
): { token: string; expiresAt: number } => {
  const expiresAt = now + ADMIN_SESSION_TTL_MS;
  const expiresAtRaw = String(expiresAt);
  return { token: `${expiresAtRaw}.${sign(expiresAtRaw, secret)}`, expiresAt };
};

export const verifyToken = (
  token: string | undefined,
  secret: string,
): boolean => {
  if (!token) return false;
  const [expiresAtRaw, signature] = token.split(".");
  if (!expiresAtRaw || !signature) return false;

  const expiresAt = Number(expiresAtRaw);
  if (!Number.isFinite(expiresAt) || expiresAt < Date.now()) return false;

  const expected = sign(expiresAtRaw, secret);
  const expectedBuffer = Buffer.from(expected);
  const providedBuffer = Buffer.from(signature);
  return (
    expectedBuffer.length === providedBuffer.length &&
    timingSafeEqual(expectedBuffer, providedBuffer)
  );
};

export const getBearerToken = (authorizationHeader: string | undefined) => {
  if (!authorizationHeader?.startsWith("Bearer ")) return undefined;
  return authorizationHeader.slice("Bearer ".length).trim() || undefined;
};
