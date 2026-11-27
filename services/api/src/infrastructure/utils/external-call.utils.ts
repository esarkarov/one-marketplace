import { env } from "@/config/env.js";
import { logger } from "@/config/logger.js";
import {
  EXTERNAL_MIN_ATTEMPT_MS,
  EXTERNAL_POLICIES,
  EXTERNAL_RETRYABLE_NETWORK_CODE_PREFIX,
  EXTERNAL_RETRYABLE_NETWORK_CODES,
  EXTERNAL_RETRYABLE_STATUSES,
} from "@/infrastructure/constants/index.js";
import { reportExternalCall } from "@/infrastructure/telemetry/metrics.js";
import type { ExternalCall } from "@/infrastructure/telemetry/metrics.js";
import type {
  ExternalCallErrorDetails,
  ExternalCallKind,
  ExternalCallOptions,
  ExternalPolicy,
  ExternalPolicyKey,
  ExternalRetry,
} from "@/infrastructure/types/external-call.types.js";

export class ExternalCallError extends Error {
  readonly policyKey: string;
  readonly kind: ExternalCallKind;
  readonly status: number | undefined;
  readonly attempts: number;

  constructor(details: ExternalCallErrorDetails) {
    super(`External call ${details.policyKey} failed (${details.kind}).`, {
      cause: details.cause,
    });
    this.name = "ExternalCallError";
    this.policyKey = details.policyKey;
    this.kind = details.kind;
    this.status = details.status;
    this.attempts = details.attempts;
  }
}

type AttemptResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: unknown; timedOut: boolean; callerAborted: boolean };

interface Failure {
  kind: ExternalCallKind | undefined;
  status: number | undefined;
  error: unknown;
}

const MAX_CAUSE_DEPTH = 4;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

export const networkCodeOf = (error: unknown): string | undefined => {
  let current: unknown = error;
  for (
    let depth = 0;
    depth < MAX_CAUSE_DEPTH && isRecord(current);
    depth += 1
  ) {
    const { code } = current;
    if (
      typeof code === "string" &&
      (EXTERNAL_RETRYABLE_NETWORK_CODES.has(code) ||
        code.startsWith(EXTERNAL_RETRYABLE_NETWORK_CODE_PREFIX))
    ) {
      return code;
    }
    current = current.cause;
  }
  return undefined;
};

export const statusOf = (error: unknown): number | undefined => {
  if (!isRecord(error)) return undefined;
  const { status } = error;
  return typeof status === "number" &&
    Number.isInteger(status) &&
    status >= 100 &&
    status <= 599
    ? status
    : undefined;
};

const classify = (result: {
  error: unknown;
  timedOut: boolean;
  callerAborted: boolean;
}): Failure => {
  const { error } = result;
  if (result.callerAborted)
    return { kind: "aborted", status: undefined, error };
  if (result.timedOut) return { kind: "timeout", status: undefined, error };
  const status = statusOf(error);
  if (status !== undefined) return { kind: "status", status, error };
  if (networkCodeOf(error))
    return { kind: "network", status: undefined, error };
  return { kind: undefined, status: undefined, error };
};

export const isRetryable = (failure: Failure): boolean => {
  if (failure.kind === "timeout" || failure.kind === "network") return true;
  return (
    failure.kind === "status" &&
    failure.status !== undefined &&
    EXTERNAL_RETRYABLE_STATUSES.has(failure.status)
  );
};

export const backoffDelayMs = (
  retry: ExternalRetry,
  retryIndex: number,
  random: () => number,
): number => {
  const cap = Math.min(retry.maxMs, retry.baseMs * 2 ** retryIndex);
  const fraction = Math.min(Math.max(random(), 0), 1);
  return Math.floor(fraction * cap);
};

const retriesEnabled = (): boolean => env.externalCallRetries !== "off";

const runAttempt = async <T>(
  run: (signal: AbortSignal) => Promise<T>,
  timeoutMs: number,
  callerSignal: AbortSignal | undefined,
): Promise<AttemptResult<T>> => {
  const timeoutSignal = AbortSignal.timeout(timeoutMs);
  const signal = AbortSignal.any(
    callerSignal ? [timeoutSignal, callerSignal] : [timeoutSignal],
  );
  let onAbort: (() => void) | undefined;
  const abandoned = new Promise<never>((_resolve, reject) => {
    onAbort = () => reject(signal.reason);
    if (signal.aborted) onAbort();
    else signal.addEventListener("abort", onAbort, { once: true });
  });
  try {
    const value = await Promise.race([run(signal), abandoned]);
    return { ok: true, value };
  } catch (error) {
    const callerAborted = callerSignal?.aborted === true;
    return {
      ok: false,
      error,
      callerAborted,
      timedOut: timeoutSignal.aborted && !callerAborted,
    };
  } finally {
    if (onAbort) signal.removeEventListener("abort", onAbort);
  }
};

const sleep = (ms: number, signal: AbortSignal | undefined) =>
  new Promise<boolean>((resolve) => {
    if (signal?.aborted) {
      resolve(false);
      return;
    }
    const onAbort = () => {
      clearTimeout(timer);
      resolve(false);
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve(true);
    }, ms);
    signal?.addEventListener("abort", onAbort, { once: true });
  });

const outcomeOf = (
  kind: ExternalCallKind | undefined,
): ExternalCall["outcome"] => {
  if (kind === "timeout") return "timeout";
  if (kind === "aborted") return "aborted";
  return "failure";
};

const logRetry = async (
  policyKey: string,
  attempt: number,
  delayMs: number,
  failure: Failure,
) => {
  try {
    await logger.debug({
      message: "External call will be retried",
      eventName: "external.call.retry",
      attributes: {
        "external.policy": policyKey,
        "external.attempt": attempt,
        "external.delay_ms": delayMs,
        "external.kind": failure.kind ?? "unknown",
        ...(failure.status === undefined
          ? {}
          : { "external.status": failure.status }),
      },
    });
  } catch {}
};

const logFailure = async (
  policyKey: string,
  outcome: ExternalCall["outcome"],
  attempts: number,
  status: number | undefined,
) => {
  try {
    await logger.warn({
      message: "External call failed",
      eventName: "external.call.failed",
      attributes: {
        "external.policy": policyKey,
        "external.outcome": outcome,
        "external.attempts": attempts,
        ...(status === undefined ? {} : { "external.status": status }),
      },
    });
  } catch {}
};

export const callWithPolicy = async <T>(
  policyKey: string,
  policy: ExternalPolicy,
  run: (signal: AbortSignal) => Promise<T>,
  options: ExternalCallOptions = {},
): Promise<T> => {
  const { signal: callerSignal } = options;
  const random = options.random ?? Math.random;
  const retry =
    retriesEnabled() && policy.idempotent ? policy.retry : undefined;
  const maxAttempts = 1 + (retry?.max ?? 0);
  const startedAt = Date.now();

  const report = (outcome: ExternalCall["outcome"], attempts: number) =>
    reportExternalCall({
      service: policy.target,
      operation: policy.operation,
      outcome,
      attempts,
      durationMs: Date.now() - startedAt,
    });

  const fail = async (failure: Failure, attempts: number): Promise<never> => {
    const outcome = outcomeOf(failure.kind);
    report(outcome, attempts);
    if (failure.kind !== "aborted") {
      await logFailure(policyKey, outcome, attempts, failure.status);
    }
    if (failure.kind === undefined) throw failure.error;
    throw new ExternalCallError({
      policyKey,
      kind: failure.kind,
      ...(failure.status === undefined ? {} : { status: failure.status }),
      attempts,
      cause: failure.error,
    });
  };

  for (let attempt = 1; ; attempt += 1) {
    if (callerSignal?.aborted) {
      return fail(
        { kind: "aborted", status: undefined, error: callerSignal.reason },
        attempt - 1,
      );
    }
    const remainingMs = retry
      ? retry.totalBudgetMs - (Date.now() - startedAt)
      : policy.timeoutMs;
    const result = await runAttempt(
      run,
      Math.max(1, Math.min(policy.timeoutMs, remainingMs)),
      callerSignal,
    );
    if (result.ok) {
      report("success", attempt);
      return result.value;
    }

    const failure = classify(result);
    if (retry && attempt < maxAttempts && isRetryable(failure)) {
      const delayMs = backoffDelayMs(retry, attempt - 1, random);
      if (
        Date.now() - startedAt + delayMs + EXTERNAL_MIN_ATTEMPT_MS <=
        retry.totalBudgetMs
      ) {
        await logRetry(policyKey, attempt, delayMs, failure);
        if (await sleep(delayMs, callerSignal)) continue;
        return fail(
          { kind: "aborted", status: undefined, error: callerSignal?.reason },
          attempt,
        );
      }
    }
    return fail(failure, attempt);
  }
};

export const callExternal = <T>(
  policyKey: ExternalPolicyKey,
  run: (signal: AbortSignal) => Promise<T>,
  options?: ExternalCallOptions,
): Promise<T> =>
  callWithPolicy(policyKey, EXTERNAL_POLICIES[policyKey], run, options);
