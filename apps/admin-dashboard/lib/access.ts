import { safeNextPath } from "./safe-next-path";

export type AccessDecision =
  | { action: "allow" }
  | { action: "redirect-login"; next: string }
  | { action: "unauthenticated" };

export interface AccessInput {
  hasSessionCookie: boolean;
  pathname: string;
  search?: string;
  isApiRoute: boolean;
}

export const UNAUTHENTICATED_BODY = {
  success: false,
  message: "Admin session is missing or expired.",
  code: "UNAUTHENTICATED",
} as const;

const isPublicPath = (pathname: string) =>
  pathname === "/login" ||
  pathname.startsWith("/login/") ||
  pathname === "/api/session";

export function decideAccess({
  hasSessionCookie,
  pathname,
  search = "",
  isApiRoute,
}: AccessInput): AccessDecision {
  if (isPublicPath(pathname)) return { action: "allow" };
  if (hasSessionCookie) return { action: "allow" };
  if (isApiRoute) return { action: "unauthenticated" };
  return {
    action: "redirect-login",
    next: safeNextPath(`${pathname}${search}`),
  };
}
