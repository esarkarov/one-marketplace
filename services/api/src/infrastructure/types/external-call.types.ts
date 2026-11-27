import type { EXTERNAL_POLICIES } from "@/infrastructure/constants/index.js";

export type ExternalCallKind = "timeout" | "network" | "status" | "aborted";

export interface ExternalRetry {
  max: number;
  baseMs: number;
  maxMs: number;
  totalBudgetMs: number;
}

interface ExternalPolicyBase {
  target: string;
  operation: string;
  timeoutMs: number;
}

interface IdempotentPolicy extends ExternalPolicyBase {
  idempotent: true;
  retry?: ExternalRetry;
}

interface NonIdempotentPolicy extends ExternalPolicyBase {
  idempotent: false;
  retry?: never;
}

export type ExternalPolicy = IdempotentPolicy | NonIdempotentPolicy;

export type ExternalPolicyKey = keyof typeof EXTERNAL_POLICIES;

export interface ExternalCallOptions {
  signal?: AbortSignal;
  random?: () => number;
}

export interface ExternalCallErrorDetails {
  policyKey: string;
  kind: ExternalCallKind;
  status?: number;
  attempts: number;
  cause: unknown;
}
