import { PgDialect } from "drizzle-orm/pg-core";
import { describe, expect, it, vi } from "vitest";

const dbMocks = vi.hoisted(() => ({ update: vi.fn() }));

vi.mock("../../database/client.js", () => ({ db: { update: dbMocks.update } }));

const {
  PAYOUT_STATUSES,
  ALLOWED_TRANSITIONS,
  PayoutTransitionError,
  assertTransition,
  allowedFrom,
} = await import("./payouts.state.js");
const { buildTransitionGuard, claimableCondition, transitionPayoutIfAllowed } =
  await import("./payouts.repository.js");
const { db } = await import("../../database/client.js");

const dialect = new PgDialect();
const id = "7f2b8c1e-9a4d-4e7f-8b21-5c6d7e8f9a0b";

const allowed = [
  ["PENDING", "PROCESSING"],
  ["PENDING", "FAILED"],
  ["FAILED", "PROCESSING"],
  ["PROCESSING", "PAID"],
  ["PROCESSING", "FAILED"],
  ["PROCESSING", "PROCESSING"],
] as const;

const disallowed = PAYOUT_STATUSES.flatMap((from) =>
  PAYOUT_STATUSES.map((to) => [from, to] as const),
).filter(([from, to]) => !allowed.some(([f, t]) => f === from && t === to));

describe("assertTransition", () => {
  it("covers all sixteen pairs", () => {
    expect(allowed.length + disallowed.length).toBe(16);
  });

  it.each(allowed)("allows %s -> %s", (from, to) => {
    expect(() => assertTransition(from, to)).not.toThrow();
  });

  it.each(disallowed)("rejects %s -> %s", (from, to) => {
    expect(() => assertTransition(from, to)).toThrow(PayoutTransitionError);
  });

  it("carries the pair on the error", () => {
    try {
      assertTransition("PAID", "FAILED");
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(PayoutTransitionError);
      expect((error as InstanceType<typeof PayoutTransitionError>).from).toBe(
        "PAID",
      );
    }
  });

  it("keeps PAID terminal", () => {
    expect(ALLOWED_TRANSITIONS.PAID).toEqual([]);
  });

  it("lists the allowed sources per target", () => {
    expect(allowedFrom("PROCESSING")).toEqual([
      "PENDING",
      "PROCESSING",
      "FAILED",
    ]);
    expect(allowedFrom("PAID")).toEqual(["PROCESSING"]);
    expect(allowedFrom("FAILED")).toEqual(["PENDING", "PROCESSING"]);
    expect(allowedFrom("PENDING")).toEqual([]);
  });
});

describe("buildTransitionGuard", () => {
  const render = (guard: ReturnType<typeof buildTransitionGuard>) =>
    dialect.sqlToQuery(guard);

  it("guards the claim on every allowed source", () => {
    const { sql, params } = render(buildTransitionGuard(id, "PROCESSING"));

    expect(sql).toContain("= ANY(ARRAY[");
    expect(sql).toContain('"next_retry_at" <= now()');
    expect(sql).toContain("interval '15 minutes'");
    expect(sql).toContain("FOR UPDATE SKIP LOCKED");
    expect(params).toEqual(
      expect.arrayContaining([id, "PENDING", "FAILED", "PROCESSING"]),
    );
  });

  it("limits PAID to PROCESSING", () => {
    const { sql, params } = render(buildTransitionGuard(id, "PAID"));

    expect(params).toContain("PROCESSING");
    expect(params).not.toContain("PENDING");
    expect(sql).not.toContain("FOR UPDATE");
  });

  it("fences on attempts", () => {
    const { params } = render(
      buildTransitionGuard(id, "PAID", { expectedAttempts: 3 }),
    );
    expect(params).toContain(3);
  });

  it("rejects a disallowed explicit source", () => {
    expect(() => buildTransitionGuard(id, "PAID", { from: "FAILED" })).toThrow(
      PayoutTransitionError,
    );
  });

  it("has no source for PENDING", () => {
    expect(() => buildTransitionGuard(id, "PENDING")).toThrow();
  });

  it("renders the claimable condition", () => {
    const { sql } = dialect.sqlToQuery(claimableCondition());
    expect(sql).toContain("interval '15 minutes'");
  });
});

describe("transitionPayout", () => {
  it("throws before touching the database for a disallowed pair", async () => {
    await expect(
      transitionPayoutIfAllowed(db, { id, to: "PAID", from: "PAID" }),
    ).rejects.toBeInstanceOf(PayoutTransitionError);
    expect(dbMocks.update).not.toHaveBeenCalled();
  });

  it("returns the updated row or undefined", async () => {
    const returning = vi.fn().mockResolvedValue([{ id, status: "PAID" }]);
    const where = vi.fn().mockReturnValue({ returning });
    const set = vi.fn().mockReturnValue({ where });
    dbMocks.update.mockReturnValue({ set });

    await expect(
      transitionPayoutIfAllowed(db, {
        id,
        to: "PAID",
        set: { last_error: null },
      }),
    ).resolves.toEqual({ id, status: "PAID" });
    expect(set).toHaveBeenCalledWith({ last_error: null, status: "PAID" });

    returning.mockResolvedValue([]);
    await expect(
      transitionPayoutIfAllowed(db, { id, to: "PAID" }),
    ).resolves.toBeUndefined();
  });
});
