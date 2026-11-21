import { describe, expect, it } from "vitest";
import { decideAccountGate, ONBOARDING_PATH } from "./account-gate";

const ready = {
  role: "client" as const,
  accountExists: true,
  isOnboarded: true,
};

describe("decideAccountGate", () => {
  it("waits while the account status loads", () => {
    expect(
      decideAccountGate({ status: "pending", auth: undefined, pathname: "/" }),
    ).toEqual({ action: "wait" });
    expect(
      decideAccountGate({ status: "success", auth: null, pathname: "/" }),
    ).toEqual({ action: "wait" });
  });

  it("sends a failed status check to the landing page", () => {
    expect(
      decideAccountGate({ status: "error", auth: undefined, pathname: "/" }),
    ).toEqual({ action: "redirect-landing" });
  });

  it("sends a missing account or another role to the landing page", () => {
    expect(
      decideAccountGate({
        status: "success",
        auth: { ...ready, accountExists: false },
        pathname: "/jobs",
      }),
    ).toEqual({ action: "redirect-landing" });
    expect(
      decideAccountGate({
        status: "success",
        auth: { ...ready, role: "freelancer" },
        pathname: "/jobs",
      }),
    ).toEqual({ action: "redirect-landing" });
  });

  it("sends a client that is not onboarded to the profile editor", () => {
    expect(
      decideAccountGate({
        status: "success",
        auth: { ...ready, isOnboarded: false },
        pathname: "/jobs",
      }),
    ).toEqual({ action: "redirect", to: ONBOARDING_PATH });
  });

  it("lets a client that is not onboarded edit the profile", () => {
    expect(
      decideAccountGate({
        status: "success",
        auth: { ...ready, isOnboarded: false },
        pathname: "/profile/edit",
      }),
    ).toEqual({ action: "allow" });
  });

  it("allows an onboarded client everywhere", () => {
    expect(
      decideAccountGate({ status: "success", auth: ready, pathname: "/jobs" }),
    ).toEqual({ action: "allow" });
    expect(
      decideAccountGate({
        status: "success",
        auth: ready,
        pathname: "/profile/edit",
      }),
    ).toEqual({ action: "allow" });
  });
});
