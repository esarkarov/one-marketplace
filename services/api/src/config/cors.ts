import { env } from "./env.js";

const toOrigin = (
  name: string,
  value: string | undefined,
  fallback: string,
) => {
  const candidate = value || (env.nodeEnv === "production" ? "" : fallback);

  if (!candidate) return undefined;

  try {
    return new URL(candidate).origin;
  } catch {
    throw new Error(`${name} must be a valid URL.`);
  }
};

export const allowedOrigins: string[] = [
  toOrigin("CLIENT_DASHBOARD", env.clientDashboard, "http://localhost:3001"),
  toOrigin(
    "FREELANCER_DASHBOARD",
    env.freelancerDashboard,
    "http://localhost:3002",
  ),
  toOrigin("AGENCY_DASHBOARD", env.agencyDashboard, "http://localhost:3003"),
  toOrigin("ADMIN_DASHBOARD", env.adminDashboard, "http://localhost:3004"),
].filter((origin): origin is string => origin !== undefined);

const originCallback = (
  origin: string | undefined,
  callback: (error: Error | null, allow?: boolean) => void,
) => {
  callback(null, !origin || allowedOrigins.includes(origin));
};

export const corsOptions = {
  origin: originCallback,
  credentials: false,
};

export const socketCorsOptions = {
  origin: originCallback,
  credentials: true,
};
