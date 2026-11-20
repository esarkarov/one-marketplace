import { NextRequest, NextResponse } from "next/server";
import { decideAccess, UNAUTHENTICATED_BODY } from "./lib/access";
import { SESSION_COOKIE } from "./lib/admin-session";

export function proxy(request: NextRequest) {
  const { pathname, search } = request.nextUrl;
  const decision = decideAccess({
    hasSessionCookie: Boolean(request.cookies.get(SESSION_COOKIE)?.value),
    pathname,
    search,
    isApiRoute: pathname === "/api" || pathname.startsWith("/api/"),
  });

  if (decision.action === "allow") return NextResponse.next();

  if (decision.action === "unauthenticated") {
    return NextResponse.json(UNAUTHENTICATED_BODY, { status: 401 });
  }

  const loginUrl = new URL("/login", request.url);
  loginUrl.searchParams.set("next", decision.next);
  return NextResponse.redirect(loginUrl);
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
