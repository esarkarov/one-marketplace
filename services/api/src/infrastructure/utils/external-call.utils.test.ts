import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ExternalCall } from "@/infrastructure/telemetry/metrics.js";
import type { ExternalPolicy } from "@/infrastructure/types/external-call.types.js";

const hoisted = vi.hoisted(() => ({
  env: { externalCallRetries: "on" as "on" | "off" },
  warn: vi.fn(async () => undefined),
  debug: vi.fn(async () => undefined),
}));

vi.mock("@/config/env.js", () => ({ env: hoisted.env }));
vi.mock("@/config/logger.js", () => ({
  logger: { warn: hoisted.warn, debug: hoisted.debug },
  registerLogEventListener: vi.fn(),
}));

const { EXTERNAL_POLICIES } =
  await import("@/infrastructure/constants/index.js");
const { registerExternalCallObserver } =
  await import("@/infrastructure/telemetry/metrics.js");
const { backoffDelayMs, callExternal, callWithPolicy, ExternalCallError } =
  await import("./external-call.utils.js");

const retrying: ExternalPolicy = {
  target: "svc",
  operation: "read",
  timeoutMs: 1_000,
  idempotent: true,
  retry: { max: 2, baseMs: 100, maxMs: 400, totalBudgetMs: 10_000 },
};

const nonIdempotent: ExternalPolicy = {
  target: "svc",
  operation: "write",
  timeoutMs: 1_000,
  idempotent: false,
};

const statusError = (status: number) =>
  Object.assign(new Error(`status ${status}`), { status });

const networkError = (code: string) =>
  new TypeError("fetch failed", {
    cause: Object.assign(new Error(code), { code }),
  });

const half = () => 0.5;

let observed: ExternalCall[] = [];

beforeEach(() => {
  observed = [];
  hoisted.env.externalCallRetries = "on";
  hoisted.warn.mockClear();
  hoisted.debug.mockClear();
  registerExternalCallObserver((call) => observed.push(call));
});

afterEach(() => {
  registerExternalCallObserver(null);
  vi.useRealTimers();
});

const settle = async <T>(promise: Promise<T>) => {
  const result = promise.then(
    (value) => ({ value, error: undefined }),
    (error: unknown) => ({ value: undefined, error }),
  );
  await vi.runAllTimersAsync();
  return result;
};

describe("callWithPolicy", () => {
  it("returns the first successful result and reports one attempt", async () => {
    const run = vi.fn(async () => "ok");

    await expect(callWithPolicy("svc.read", retrying, run)).resolves.toBe("ok");

    expect(run).toHaveBeenCalledTimes(1);
    expect(observed).toEqual([
      expect.objectContaining({ outcome: "success", attempts: 1 }),
    ]);
  });

  it("passes an AbortSignal to the call", async () => {
    const run = vi.fn(async (signal: AbortSignal) => signal);

    const signal = await callWithPolicy("svc.read", retrying, run);

    expect(signal).toBeInstanceOf(AbortSignal);
    expect(signal.aborted).toBe(false);
  });

  it("retries a retryable status after a jittered delay, then succeeds", async () => {
    vi.useFakeTimers();
    const run = vi
      .fn<() => Promise<string>>()
      .mockRejectedValueOnce(statusError(503))
      .mockResolvedValueOnce("ok");

    const pending = callWithPolicy("svc.read", retrying, run, { random: half });
    await vi.advanceTimersByTimeAsync(49);
    expect(run).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);

    await expect(pending).resolves.toBe("ok");
    expect(run).toHaveBeenCalledTimes(2);
    expect(hoisted.debug).toHaveBeenCalledTimes(1);
    expect(observed).toEqual([
      expect.objectContaining({ outcome: "success", attempts: 2 }),
    ]);
  });

  it.each([429, 502, 503, 504])("retries status %i", async (status) => {
    vi.useFakeTimers();
    const run = vi.fn(async () => {
      throw statusError(status);
    });

    const { error } = await settle(callWithPolicy("svc.read", retrying, run));

    expect(run).toHaveBeenCalledTimes(3);
    expect(error).toMatchObject({ kind: "status", status, attempts: 3 });
  });

  it.each([400, 401, 403, 404, 409, 422, 500])(
    "never retries status %i",
    async (status) => {
      const run = vi.fn(async () => {
        throw statusError(status);
      });

      const error = await callWithPolicy("svc.read", retrying, run).catch(
        (e: unknown) => e,
      );

      expect(run).toHaveBeenCalledTimes(1);
      expect(error).toBeInstanceOf(ExternalCallError);
      expect(error).toMatchObject({ kind: "status", status, attempts: 1 });
    },
  );

  it.each([
    "ECONNRESET",
    "ECONNREFUSED",
    "ETIMEDOUT",
    "EAI_AGAIN",
    "UND_ERR_SOCKET",
  ])("retries the network code %s found on the cause", async (code) => {
    vi.useFakeTimers();
    const run = vi
      .fn<() => Promise<string>>()
      .mockRejectedValueOnce(networkError(code))
      .mockResolvedValueOnce("ok");

    const { value } = await settle(callWithPolicy("svc.read", retrying, run));

    expect(value).toBe("ok");
    expect(run).toHaveBeenCalledTimes(2);
  });

  it("never retries a non-idempotent policy even when a retry is forced onto it", async () => {
    const forced = {
      ...nonIdempotent,
      retry: { max: 2, baseMs: 1, maxMs: 1, totalBudgetMs: 10_000 },
    } as unknown as ExternalPolicy;
    const run = vi.fn(async () => {
      throw statusError(503);
    });

    await expect(
      callWithPolicy("svc.write", forced, run),
    ).rejects.toMatchObject({ attempts: 1 });
    expect(run).toHaveBeenCalledTimes(1);
  });

  it("does not retry when the budget left after the delay is too short for an attempt", async () => {
    vi.useFakeTimers();
    const tight: ExternalPolicy = {
      ...retrying,
      idempotent: true,
      retry: { max: 2, baseMs: 100, maxMs: 100, totalBudgetMs: 120 },
    };
    const run = vi.fn(async () => {
      throw statusError(503);
    });

    const { error } = await settle(
      callWithPolicy("svc.read", tight, run, { random: half }),
    );

    expect(run).toHaveBeenCalledTimes(1);
    expect(error).toMatchObject({ attempts: 1 });
  });

  it("never retries a non-idempotent policy", async () => {
    const run = vi.fn(async () => {
      throw statusError(503);
    });

    const error = await callWithPolicy("svc.write", nonIdempotent, run).catch(
      (e: unknown) => e,
    );

    expect(run).toHaveBeenCalledTimes(1);
    expect(error).toMatchObject({ kind: "status", status: 503, attempts: 1 });
  });

  it("gives an ExternalCallError with the attempts and the last cause when retries run out", async () => {
    vi.useFakeTimers();
    const last = statusError(502);
    const run = vi
      .fn<() => Promise<string>>()
      .mockRejectedValueOnce(statusError(503))
      .mockRejectedValueOnce(statusError(503))
      .mockRejectedValueOnce(last);

    const { error } = await settle(callWithPolicy("svc.read", retrying, run));

    expect(error).toBeInstanceOf(ExternalCallError);
    expect(error).toMatchObject({
      policyKey: "svc.read",
      kind: "status",
      status: 502,
      attempts: 3,
      cause: last,
    });
    expect(hoisted.warn).toHaveBeenCalledTimes(1);
  });

  const controlTimeouts = () => {
    const controllers: AbortController[] = [];
    const spy = vi.spyOn(AbortSignal, "timeout").mockImplementation(() => {
      const controller = new AbortController();
      controllers.push(controller);
      return controller.signal;
    });
    const fire = (index: number) =>
      controllers[index]!.abort(new DOMException("timed out", "TimeoutError"));
    return { controllers, spy, fire };
  };

  it("classifies a timeout by the timeout signal and retries it", async () => {
    vi.useFakeTimers();
    const timeouts = controlTimeouts();
    const run = vi
      .fn<(signal: AbortSignal) => Promise<string>>()
      .mockImplementationOnce(() => new Promise<string>(() => undefined))
      .mockResolvedValueOnce("ok");

    const pending = callWithPolicy("svc.read", retrying, run, { random: half });
    await vi.advanceTimersByTimeAsync(0);
    timeouts.fire(0);
    await vi.advanceTimersByTimeAsync(50);

    await expect(pending).resolves.toBe("ok");
    expect(run).toHaveBeenCalledTimes(2);
    expect(timeouts.spy).toHaveBeenCalledWith(1_000);
    timeouts.spy.mockRestore();
  });

  it("ends a hanging call at the timeout even when the call ignores the signal", async () => {
    const timeouts = controlTimeouts();
    const run = vi.fn(() => new Promise<string>(() => undefined));

    const pending = callWithPolicy("svc.write", nonIdempotent, run);
    const assertion = expect(pending).rejects.toMatchObject({
      kind: "timeout",
      attempts: 1,
    });
    timeouts.fire(0);

    await assertion;
    expect(observed).toEqual([
      expect.objectContaining({ outcome: "timeout", attempts: 1 }),
    ]);
    timeouts.spy.mockRestore();
  });

  it("classifies a caller abort as aborted even when the timeout also fired", async () => {
    const timeouts = controlTimeouts();
    const controller = new AbortController();
    const run = vi.fn(() => new Promise<string>(() => undefined));

    const pending = callWithPolicy("svc.read", retrying, run, {
      signal: controller.signal,
    });
    const assertion = expect(pending).rejects.toMatchObject({
      kind: "aborted",
    });
    controller.abort();
    timeouts.fire(0);

    await assertion;
    expect(run).toHaveBeenCalledTimes(1);
    timeouts.spy.mockRestore();
  });

  it("does not treat an error named TimeoutError as a timeout when no signal fired", async () => {
    const thrown = new DOMException("late", "TimeoutError");
    const run = vi.fn(async () => {
      throw thrown;
    });

    const error = await callWithPolicy("svc.read", retrying, run).catch(
      (e: unknown) => e,
    );

    expect(error).toBe(thrown);
    expect(run).toHaveBeenCalledTimes(1);
    expect(observed).toEqual([
      expect.objectContaining({ outcome: "failure", attempts: 1 }),
    ]);
  });

  it("ends at once with kind aborted when the caller aborts during an attempt", async () => {
    const controller = new AbortController();
    const run = vi.fn(() => new Promise<string>(() => undefined));

    const pending = callWithPolicy("svc.read", retrying, run, {
      signal: controller.signal,
    });
    controller.abort();

    await expect(pending).rejects.toMatchObject({
      kind: "aborted",
      attempts: 1,
    });
    expect(run).toHaveBeenCalledTimes(1);
    expect(observed).toEqual([
      expect.objectContaining({ outcome: "aborted", attempts: 1 }),
    ]);
    expect(hoisted.warn).not.toHaveBeenCalled();
  });

  it("ends with kind aborted when the caller aborts during the backoff", async () => {
    vi.useFakeTimers();
    const controller = new AbortController();
    const run = vi.fn(async () => {
      throw statusError(503);
    });

    const pending = callWithPolicy("svc.read", retrying, run, {
      signal: controller.signal,
      random: half,
    });
    const assertion = expect(pending).rejects.toMatchObject({
      kind: "aborted",
    });
    await vi.advanceTimersByTimeAsync(10);
    controller.abort();

    await assertion;
    expect(run).toHaveBeenCalledTimes(1);
  });

  it("does not call when the caller signal is already aborted", async () => {
    const run = vi.fn(async () => "ok");

    await expect(
      callWithPolicy("svc.read", retrying, run, {
        signal: AbortSignal.abort(),
      }),
    ).rejects.toMatchObject({ kind: "aborted", attempts: 0 });
    expect(run).not.toHaveBeenCalled();
  });

  it("stops retrying when the next delay would exceed the total budget", async () => {
    vi.useFakeTimers();
    const tight: ExternalPolicy = {
      ...retrying,
      idempotent: true,
      retry: { max: 3, baseMs: 1_000, maxMs: 1_000, totalBudgetMs: 500 },
    };
    const run = vi.fn(async () => {
      throw statusError(503);
    });

    const { error } = await settle(
      callWithPolicy("svc.read", tight, run, { random: () => 0.9 }),
    );

    expect(run).toHaveBeenCalledTimes(1);
    expect(error).toMatchObject({ kind: "status", attempts: 1 });
  });

  it("makes one attempt when EXTERNAL_CALL_RETRIES is off and keeps the timeout", async () => {
    vi.useFakeTimers();
    hoisted.env.externalCallRetries = "off";
    const timeoutSpy = vi.spyOn(AbortSignal, "timeout");
    const run = vi.fn(async () => {
      throw statusError(503);
    });

    const { error } = await settle(callWithPolicy("svc.read", retrying, run));

    expect(run).toHaveBeenCalledTimes(1);
    expect(timeoutSpy).toHaveBeenCalledWith(1_000);
    expect(error).toMatchObject({ kind: "status", attempts: 1 });
    timeoutSpy.mockRestore();
  });

  it("calls the observer exactly once per call with only low-cardinality fields", async () => {
    vi.useFakeTimers();
    const run = vi.fn(async () => {
      throw statusError(503);
    });

    await settle(callWithPolicy("svc.read", retrying, run));

    expect(observed).toHaveLength(1);
    expect(Object.keys(observed[0]!).sort()).toEqual(
      ["attempts", "durationMs", "operation", "outcome", "service"].sort(),
    );
    expect(observed[0]).toMatchObject({
      service: "svc",
      operation: "read",
      outcome: "failure",
      attempts: 3,
    });
  });

  it("logs the failure once without the error message", async () => {
    const run = vi.fn(async () => {
      throw new Error("https://secret.example/path?token=abc");
    });

    await callWithPolicy("svc.read", retrying, run).catch(() => undefined);

    expect(hoisted.warn).toHaveBeenCalledTimes(1);
    const payload = JSON.stringify(hoisted.warn.mock.calls[0]);
    expect(payload).toContain("external.call.failed");
    expect(payload).not.toContain("secret.example");
    expect(payload).not.toContain("token");
  });
});

describe("backoffDelayMs", () => {
  const retry = { max: 5, baseMs: 100, maxMs: 450, totalBudgetMs: 10_000 };

  it("stays within zero and the capped exponential bound", () => {
    for (const [index, cap] of [
      [0, 100],
      [1, 200],
      [2, 400],
      [3, 450],
      [4, 450],
    ] as const) {
      expect(backoffDelayMs(retry, index, () => 0)).toBe(0);
      const high = backoffDelayMs(retry, index, () => 0.999_999);
      expect(high).toBeGreaterThanOrEqual(0);
      expect(high).toBeLessThan(cap);
      expect(backoffDelayMs(retry, index, () => 0.5)).toBe(Math.floor(cap / 2));
    }
  });

  it("clamps a random source outside zero to one", () => {
    expect(backoffDelayMs(retry, 0, () => -1)).toBe(0);
    expect(backoffDelayMs(retry, 0, () => 2)).toBe(100);
  });
});

describe("EXTERNAL_POLICIES", () => {
  const entries = Object.entries(EXTERNAL_POLICIES) as [
    string,
    ExternalPolicy,
  ][];

  it.each(entries)("%s retries only when idempotent", (_key, policy) => {
    if (policy.retry) expect(policy.idempotent).toBe(true);
  });

  it.each(entries)("%s has a timeout and sane retry bounds", (key, policy) => {
    expect(key).toBe(`${policy.target}.${policy.operation}`);
    expect(policy.timeoutMs).toBeGreaterThan(0);
    if (!policy.retry) return;
    expect(policy.retry.max).toBeGreaterThanOrEqual(1);
    expect(policy.retry.max).toBeLessThanOrEqual(2);
    expect(policy.retry.baseMs).toBeGreaterThan(0);
    expect(policy.retry.maxMs).toBeGreaterThanOrEqual(policy.retry.baseMs);
    expect(policy.retry.totalBudgetMs).toBeGreaterThanOrEqual(policy.timeoutMs);
  });

  it("keeps room creation non-retrying", () => {
    expect(EXTERNAL_POLICIES["daily.createRoom"].idempotent).toBe(false);
    expect("retry" in EXTERNAL_POLICIES["daily.createRoom"]).toBe(false);
  });

  it("keeps the signup lookup delays at 300 ms and 600 ms at most", () => {
    const { retry } = EXTERNAL_POLICIES["clerk.signup.getUser"];
    expect(retry.max).toBe(2);
    expect(backoffDelayMs(retry, 0, () => 0.999_999)).toBeLessThan(300);
    expect(backoffDelayMs(retry, 1, () => 0.999_999)).toBeLessThan(600);
  });

  it("callExternal applies the named policy", async () => {
    const run = vi.fn(async () => {
      throw statusError(503);
    });

    await expect(callExternal("daily.createRoom", run)).rejects.toMatchObject({
      policyKey: "daily.createRoom",
      attempts: 1,
    });
    expect(observed[0]).toMatchObject({
      service: "daily",
      operation: "createRoom",
    });
  });
});
