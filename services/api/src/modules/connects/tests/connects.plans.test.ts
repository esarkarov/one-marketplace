import { describe, expect, it } from "vitest";
import { isConnectsPlan } from "@/modules/connects/utils/connects.plans.js";

describe("isConnectsPlan", () => {
  it.each([20, 40, 80])("accepts the plan %d", (plan) => {
    expect(isConnectsPlan(plan)).toBe(true);
  });

  it.each([
    0,
    7,
    21,
    -20,
    20.5,
    Number.NaN,
    Number.POSITIVE_INFINITY,
    "20",
    null,
    undefined,
    {},
    [20],
    true,
    "toString",
    "constructor",
    "__proto__",
  ])("rejects %j", (value) => {
    expect(isConnectsPlan(value)).toBe(false);
  });
});
