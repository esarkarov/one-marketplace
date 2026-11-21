import { describe, expect, it } from "vitest";
import { isHttpsUrl } from "./url";

describe("isHttpsUrl", () => {
  it("accepts plain https urls", () => {
    expect(isHttpsUrl("https://checkout.stripe.com/c/pay/x")).toBe(true);
    expect(isHttpsUrl("https://example.com:8443/a?b=1#c")).toBe(true);
  });

  it("rejects other protocols and unparsable values", () => {
    expect(isHttpsUrl("http://example.com")).toBe(false);
    expect(isHttpsUrl("javascript:alert(1)")).toBe(false);
    expect(isHttpsUrl("data:text/html,x")).toBe(false);
    expect(isHttpsUrl("//evil.example")).toBe(false);
    expect(isHttpsUrl("not a url")).toBe(false);
    expect(isHttpsUrl("")).toBe(false);
  });

  it("rejects a username or password", () => {
    expect(isHttpsUrl("https://user@example.com/")).toBe(false);
    expect(isHttpsUrl("https://user:pass@example.com/")).toBe(false);
    expect(isHttpsUrl("https://:pass@example.com/")).toBe(false);
    expect(isHttpsUrl("https://checkout.stripe.com@evil.example/")).toBe(false);
  });
});
