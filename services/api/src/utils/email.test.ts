import { describe, expect, it } from "vitest";
import { isValidEmail } from "./email.js";

const legacy = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

describe("isValidEmail", () => {
  it.each([
    "a@b.co",
    "first.last@example.com",
    "user+tag@sub.example.org",
    "a@b..c",
    "ünï@exämple.com",
  ])("accepts %s", (value) => {
    expect(isValidEmail(value)).toBe(true);
  });

  it.each([
    "",
    "a",
    "a@",
    "@b.co",
    "a@b",
    "a@.com",
    "a@b.",
    "a@@b.co",
    "a@b@c.co",
    "a b@c.co",
    "a@b .co",
    "a@b.co\n",
    "\ta@b.co",
  ])("rejects %j", (value) => {
    expect(isValidEmail(value)).toBe(false);
  });

  it("rejects an address longer than 254 characters", () => {
    const local = "a".repeat(249);
    expect(`${local}@b.co`).toHaveLength(254);
    expect(isValidEmail(`${local}@b.co`)).toBe(true);
    expect(isValidEmail(`${local}a@b.co`)).toBe(false);
  });

  it("accepts exactly what the old regex accepted for short strings", () => {
    const alphabet = ["a", ".", "@", " "];
    const mismatches: string[] = [];
    const walk = (prefix: string, remaining: number) => {
      if (legacy.test(prefix) !== isValidEmail(prefix)) mismatches.push(prefix);
      if (remaining === 0) return;
      for (const char of alphabet) walk(prefix + char, remaining - 1);
    };
    walk("", 7);
    expect(mismatches).toEqual([]);
  });

  it.each([
    ["dots then a trailing at-sign", `a@${".".repeat(100_000)}@`],
    ["dots then a trailing space", `a@${".".repeat(100_000)} `],
    ["alternating dots", `a@${"a.".repeat(50_000)}@`],
    ["long local part", `${"a".repeat(100_000)}@`],
  ])("rejects crafted %s in linear time", (_name, input) => {
    const startedAt = performance.now();
    const result = isValidEmail(input);
    const elapsed = performance.now() - startedAt;

    expect(result).toBe(false);
    expect(elapsed).toBeLessThan(100);
  });
});
