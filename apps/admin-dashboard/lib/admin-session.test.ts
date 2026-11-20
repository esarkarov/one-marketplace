import { describe, expect, it } from "vitest";
import {
  buildSessionCookie,
  isSameOriginRequest,
  SESSION_COOKIE,
} from "./admin-session";

const NOW = Date.parse("2026-11-20T10:00:00.000Z");
const inTwoHours = new Date(NOW + 2 * 60 * 60 * 1000).toISOString();

describe("buildSessionCookie", () => {
  it("builds strict httpOnly options with maxAge from expiresAt", () => {
    const result = buildSessionCookie({
      token: "tok",
      expiresAt: inTwoHours,
      now: NOW,
      production: false,
    });
    expect(result).toEqual({
      ok: true,
      name: SESSION_COOKIE,
      value: "tok",
      options: {
        httpOnly: true,
        sameSite: "strict",
        secure: false,
        path: "/",
        maxAge: 7200,
      },
    });
  });

  it("marks the cookie secure only in production", () => {
    const build = (production: boolean) => {
      const result = buildSessionCookie({
        token: "tok",
        expiresAt: inTwoHours,
        now: NOW,
        production,
      });
      return result.ok ? result.options.secure : null;
    };
    expect(build(true)).toBe(true);
    expect(build(false)).toBe(false);
  });

  it("never lets maxAge outlive expiresAt", () => {
    const result = buildSessionCookie({
      token: "tok",
      expiresAt: new Date(NOW + 1999).toISOString(),
      now: NOW,
      production: true,
    });
    expect(result.ok && result.options.maxAge).toBe(1);
  });

  it.each([
    ["missing", undefined],
    ["null", null],
    ["not a date", "soon"],
    ["empty", ""],
    ["a number", NOW + 1000],
    ["in the past", new Date(NOW - 1000).toISOString()],
    ["exactly now", new Date(NOW).toISOString()],
    ["less than a second away", new Date(NOW + 500).toISOString()],
  ])("refuses an expiresAt that is %s", (_name, expiresAt) => {
    expect(
      buildSessionCookie({
        token: "tok",
        expiresAt,
        now: NOW,
        production: true,
      }),
    ).toEqual({ ok: false });
  });

  it.each([undefined, null, "", 5])("refuses the token %s", (token) => {
    expect(
      buildSessionCookie({
        token,
        expiresAt: inTwoHours,
        now: NOW,
        production: true,
      }),
    ).toEqual({ ok: false });
  });
});

describe("isSameOriginRequest", () => {
  const headers = (init: Record<string, string>) => new Headers(init);

  it("accepts Sec-Fetch-Site same-origin", () => {
    expect(
      isSameOriginRequest(headers({ "sec-fetch-site": "same-origin" })),
    ).toBe(true);
  });

  it.each(["cross-site", "same-site", "none"])(
    "rejects Sec-Fetch-Site %s",
    (value) => {
      expect(isSameOriginRequest(headers({ "sec-fetch-site": value }))).toBe(
        false,
      );
    },
  );

  it("lets Sec-Fetch-Site win over a matching Origin", () => {
    expect(
      isSameOriginRequest(
        headers({
          "sec-fetch-site": "cross-site",
          origin: "http://localhost:3004",
          host: "localhost:3004",
        }),
      ),
    ).toBe(false);
  });

  it("falls back to Origin against Host", () => {
    expect(
      isSameOriginRequest(
        headers({ origin: "http://localhost:3004", host: "localhost:3004" }),
      ),
    ).toBe(true);
    expect(
      isSameOriginRequest(
        headers({ origin: "https://evil.example", host: "localhost:3004" }),
      ),
    ).toBe(false);
  });

  it("rejects a malformed Origin and a request with neither header", () => {
    expect(
      isSameOriginRequest(headers({ origin: "not a url", host: "localhost" })),
    ).toBe(false);
    expect(isSameOriginRequest(headers({}))).toBe(false);
  });
});
