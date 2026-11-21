export interface GateAuthStatus {
  role: "client" | "freelancer";
  accountExists: boolean;
  isOnboarded: boolean;
}

export interface GateInput {
  status: "pending" | "error" | "success";
  auth: GateAuthStatus | null | undefined;
  pathname: string;
  expectedRole: GateAuthStatus["role"];
  onboardingPath: string;
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
  expectedRole,
  onboardingPath,
}: GateInput): GateDecision => {
  if (status === "error") return { action: "redirect-landing" };
  if (status === "pending" || !auth) return { action: "wait" };
  if (!auth.accountExists || auth.role !== expectedRole) {
    return { action: "redirect-landing" };
  }
  if (!auth.isOnboarded && pathname !== onboardingPath) {
    return { action: "redirect", to: onboardingPath };
  }
  return { action: "allow" };
};
