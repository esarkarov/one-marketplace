import { describe, expect, it } from "vitest";
import { decideAccountGate } from "./account-gate";

const ONBOARDING_PATH = "/profile/edit";
const gate = {
  expectedRole: "client" as const,
  onboardingPath: ONBOARDING_PATH,
};

const ready = {
  role: "client" as const,
  accountExists: true,
  isOnboarded: true,
};

describe("decideAccountGate", () => {
  it("waits while the account status loads", () => {
    expect(
      decideAccountGate({
        status: "pending",
        auth: undefined,
        pathname: "/",
        ...gate,
      }),
    ).toEqual({ action: "wait" });
    expect(
      decideAccountGate({
        status: "success",
        auth: null,
        pathname: "/",
        ...gate,
      }),
    ).toEqual({ action: "wait" });
  });

  it("sends a failed status check to the landing page", () => {
    expect(
      decideAccountGate({
        status: "error",
        auth: undefined,
        pathname: "/",
        ...gate,
      }),
    ).toEqual({ action: "redirect-landing" });
  });

  it("sends a missing account or another role to the landing page", () => {
    expect(
      decideAccountGate({
        status: "success",
        auth: { ...ready, accountExists: false },
        pathname: "/jobs",
        ...gate,
      }),
    ).toEqual({ action: "redirect-landing" });
    expect(
      decideAccountGate({
        status: "success",
        auth: { ...ready, role: "freelancer" },
        pathname: "/jobs",
        ...gate,
      }),
    ).toEqual({ action: "redirect-landing" });
  });

  it("sends a client that is not onboarded to the profile editor", () => {
    expect(
      decideAccountGate({
        status: "success",
        auth: { ...ready, isOnboarded: false },
        pathname: "/jobs",
        ...gate,
      }),
    ).toEqual({ action: "redirect", to: ONBOARDING_PATH });
  });

  it("lets a client that is not onboarded edit the profile", () => {
    expect(
      decideAccountGate({
        status: "success",
        auth: { ...ready, isOnboarded: false },
        pathname: "/profile/edit",
        ...gate,
      }),
    ).toEqual({ action: "allow" });
  });

  it("allows an onboarded client everywhere", () => {
    expect(
      decideAccountGate({
        status: "success",
        auth: ready,
        pathname: "/jobs",
        ...gate,
      }),
    ).toEqual({ action: "allow" });
    expect(
      decideAccountGate({
        status: "success",
        auth: ready,
        pathname: "/profile/edit",
        ...gate,
      }),
    ).toEqual({ action: "allow" });
  });

  it("takes the expected role and onboarding path as parameters", () => {
    const freelancer = { ...ready, role: "freelancer" as const };
    const params = {
      status: "success" as const,
      expectedRole: "freelancer" as const,
      onboardingPath: "/my-profile",
    };
    expect(
      decideAccountGate({ ...params, auth: freelancer, pathname: "/jobs" }),
    ).toEqual({ action: "allow" });
    expect(
      decideAccountGate({ ...params, auth: ready, pathname: "/jobs" }),
    ).toEqual({ action: "redirect-landing" });
    expect(
      decideAccountGate({
        ...params,
        auth: { ...freelancer, isOnboarded: false },
        pathname: "/jobs",
      }),
    ).toEqual({ action: "redirect", to: "/my-profile" });
  });
});
