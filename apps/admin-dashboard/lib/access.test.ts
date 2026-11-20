import { describe, expect, it } from "vitest";
import { decideAccess } from "./access";

describe("decideAccess", () => {
  it("lets a page through with a session cookie", () => {
    expect(
      decideAccess({
        hasSessionCookie: true,
        pathname: "/accounts",
        isApiRoute: false,
      }),
    ).toEqual({ action: "allow" });
  });

  it("lets an api route through with a session cookie", () => {
    expect(
      decideAccess({
        hasSessionCookie: true,
        pathname: "/api/system/health",
        isApiRoute: true,
      }),
    ).toEqual({ action: "allow" });
  });

  it("redirects a page without a cookie to login with a safe next", () => {
    expect(
      decideAccess({
        hasSessionCookie: false,
        pathname: "/contracts",
        search: "?offset=20",
        isApiRoute: false,
      }),
    ).toEqual({ action: "redirect-login", next: "/contracts?offset=20" });
  });

  it("falls back to the root when the path is not safe", () => {
    expect(
      decideAccess({
        hasSessionCookie: false,
        pathname: "//evil.example",
        isApiRoute: false,
      }),
    ).toEqual({ action: "redirect-login", next: "/" });
  });

  it("answers an api route without a cookie as unauthenticated", () => {
    expect(
      decideAccess({
        hasSessionCookie: false,
        pathname: "/api/logs/stream",
        isApiRoute: true,
      }),
    ).toEqual({ action: "unauthenticated" });
  });

  it.each([true, false])("always allows /login (cookie %s)", (cookie) => {
    expect(
      decideAccess({
        hasSessionCookie: cookie,
        pathname: "/login",
        isApiRoute: false,
      }),
    ).toEqual({ action: "allow" });
  });

  it.each([true, false])("always allows /api/session (cookie %s)", (cookie) => {
    expect(
      decideAccess({
        hasSessionCookie: cookie,
        pathname: "/api/session",
        isApiRoute: true,
      }),
    ).toEqual({ action: "allow" });
  });

  it("does not treat a lookalike as public", () => {
    expect(
      decideAccess({
        hasSessionCookie: false,
        pathname: "/login-evil",
        isApiRoute: false,
      }).action,
    ).toBe("redirect-login");
    expect(
      decideAccess({
        hasSessionCookie: false,
        pathname: "/api/session/extra",
        isApiRoute: true,
      }).action,
    ).toBe("unauthenticated");
  });
});
