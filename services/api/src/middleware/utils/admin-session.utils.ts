import { createHmac, timingSafeEqual } from "crypto";

export const verifyToken = (
  token: string | undefined,
  secret: string,
): boolean => {
  if (!token) return false;
  const [expiresAtRaw, signature] = token.split(".");
  if (!expiresAtRaw || !signature) return false;

  const expiresAt = Number(expiresAtRaw);
  if (!Number.isFinite(expiresAt) || expiresAt < Date.now()) return false;

  const expected = createHmac("sha256", secret)
    .update(expiresAtRaw)
    .digest("hex");
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
