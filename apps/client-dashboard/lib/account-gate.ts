export const ONBOARDING_PATH = "/profile/edit";

export interface GateAuthStatus {
  role: "client" | "freelancer";
  accountExists: boolean;
  isOnboarded: boolean;
}

export interface GateInput {
  status: "pending" | "error" | "success";
  auth: GateAuthStatus | null | undefined;
  pathname: string;
}

export type GateDecision =
  | { action: "wait" }
  | { action: "allow" }
  | { action: "redirect-landing" }
  | { action: "redirect"; to: string };

export const decideAccountGate = ({
  status,
  auth,
  pathname,
}: GateInput): GateDecision => {
  if (status === "error") return { action: "redirect-landing" };
  if (status === "pending" || !auth) return { action: "wait" };
  if (!auth.accountExists || auth.role !== "client") {
    return { action: "redirect-landing" };
  }
  if (!auth.isOnboarded && pathname !== ONBOARDING_PATH) {
    return { action: "redirect", to: ONBOARDING_PATH };
  }
  return { action: "allow" };
};
