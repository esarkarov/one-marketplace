export const DEFAULT_PORT = 4000;

export const CLERK_BEARER = "clerkBearer";
export const ADMIN_SESSION = "adminSession";

export const DEFS_PREFIX = "#/$defs/";
export const COMPONENTS_PREFIX = "#/components/schemas/";

export const IGNORED_PROPERTY_DESCRIPTION =
  "Accepted for compatibility and ignored by the server.";

export const CONTROLLER_AUTH_OVERRIDES: Readonly<
  Record<string, { scheme: typeof CLERK_BEARER; reason: string }>
> = {
  "POST /auth/sign-up": {
    scheme: CLERK_BEARER,
    reason:
      "The controller reads the bearer token and calls authenticateAccount, which answers 401 without a valid Clerk token.",
  },
};

export const MODULE_BY_SEGMENT: Readonly<Record<string, string>> = {
  conversations: "messaging",
  health: "system",
  ready: "system",
};
export const UNMOUNTED_SEGMENTS: ReadonlySet<string> = new Set([
  "health",
  "ready",
]);

export const SIGNATURE_HEADERS: Readonly<Record<string, readonly string[]>> = {
  stripe: ["stripe-signature"],
  daily: ["x-webhook-signature", "x-webhook-timestamp"],
};
