import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

interface Row {
  id: string;
  createdAt: string;
  earningHistoryId: string;
  amountCents: number;
  status: string;
  freelancerId: string | null;
  agencyId: string | null;
  freelancerAccountId: string | null;
  agencyAccountId: string | null;
}

interface Cursor {
  createdAt: string;
  id: string;
}

interface LogEntry {
  eventName: string;
  attributes?: Record<string, unknown>;
}

type LogFn = (entry: LogEntry) => Promise<void>;

const hoisted = vi.hoisted(() => ({
  rows: [] as Row[],
  findCalls: [] as Array<{ limit: number; after?: Cursor }>,
  findFails: false,
  claimFailsFor: new Set<string>(),
  restrictedAccounts: new Set<string>(),
  onAccountCheck: undefined as (() => void) | undefined,
  transfersCreate:
    vi.fn<
      (params: { metadata: { payoutId: string } }) => Promise<{ id: string }>
    >(),
  accountsRetrieve: vi.fn<(accountId: string) => Promise<object>>(),
  log: {
    debug: vi.fn<LogFn>(),
    info: vi.fn<LogFn>(),
    warn: vi.fn<LogFn>(),
    error: vi.fn<LogFn>(),
  },
}));

vi.mock("@/config/logger.js", () => ({ logger: hoisted.log }));

vi.mock("@/database/client.js", () => ({
  db: {
    transaction: async (callback: (transaction: object) => Promise<unknown>) =>
      callback({}),
  },
}));

vi.mock("@/infrastructure/payments/stripe.client.js", () => ({
  stripe: {
    transfers: { create: hoisted.transfersCreate, list: vi.fn() },
    v2: { core: { accounts: { retrieve: hoisted.accountsRetrieve } } },
  },
}));

vi.mock("@/modules/notification-store/index.js", () => ({
  insertNotification: vi.fn().mockResolvedValue(null),
  pushStoredNotification: vi.fn().mockResolvedValue(undefined),
}));

const isAfter = (row: Row, after: Cursor) =>
  row.createdAt > after.createdAt ||
  (row.createdAt === after.createdAt && row.id > after.id);

vi.mock("@/modules/payouts/repositories/payouts.repository.js", () => ({
  findUnnotifiedPaidPayouts: vi.fn().mockResolvedValue([]),
  insertPendingPayoutsForDueEarnings: vi.fn().mockResolvedValue(undefined),
  markPayoutNotifiedIfUnnotified: vi.fn().mockResolvedValue(undefined),
  failProcessingPayoutIfAttemptsMatch: vi.fn().mockResolvedValue(undefined),
  parkProcessingPayoutIfAttemptsMatch: vi.fn().mockResolvedValue(undefined),
  findClaimableCandidates: async (
    _executor: unknown,
    options: { limit: number; after?: Cursor },
  ) => {
    hoisted.findCalls.push(options);
    if (hoisted.findFails) throw new Error("db down");
    const { after } = options;
    return hoisted.rows
      .filter((row) => (after ? isAfter(row, after) : true))
      .slice(0, options.limit);
  },
  claimPayoutIfClaimableSkipLocked: async (
    _executor: unknown,
    input: { id: string; destination: string },
  ) => {
    if (hoisted.claimFailsFor.has(input.id)) throw new Error("claim failed");
    const row = hoisted.rows.find((candidate) => candidate.id === input.id);
    return {
      id: input.id,
      earning_history_id: row?.earningHistoryId,
      freelancer_id: row?.freelancerId,
      agency_id: null,
      amount_cents: row?.amountCents,
      attempts: 1,
      idempotency_key: `payout:${input.id}:1`,
      destination_account_id: input.destination,
      prev_claimed_at: null,
      prev_idempotency_key: null,
    };
  },
  markProcessingPayoutPaidIfAttemptsMatch: async (
    _executor: unknown,
    input: { id: string; attempts: number; transferId: string },
  ) => {
    const row = hoisted.rows.find((candidate) => candidate.id === input.id);
    return {
      id: input.id,
      earning_history_id: row?.earningHistoryId,
      freelancer_id: row?.freelancerId,
      agency_id: null,
      amount_cents: row?.amountCents,
      attempts: input.attempts,
      stripe_transfer_id: input.transferId,
      status: "PAID",
    };
  },
}));

import {
  PAYOUT_BATCH_SIZE,
  PAYOUT_MAX_PER_TICK,
  PAYOUT_TICK_BUDGET_MS,
} from "@/modules/payouts/constants/payouts.constants.js";
import { insertPendingPayoutsForDueEarnings } from "@/modules/payouts/repositories/payouts.repository.js";
import { processDuePayouts } from "@/modules/payouts/services/payouts.service.js";

const pad = (value: number) => String(value).padStart(6, "0");

const makeRows = (
  count: number,
  options: { from?: number; restricted?: boolean } = {},
): Row[] =>
  Array.from({ length: count }, (_, index) => {
    const n = (options.from ?? 0) + index;
    const accountId = `acct_${pad(n)}`;
    if (options.restricted) hoisted.restrictedAccounts.add(accountId);
    return {
      id: `00000000-0000-4000-8000-${pad(n).padStart(12, "0")}`,
      createdAt: `2026-01-01 00:00:00.${pad(Math.floor(n / 2))}+00`,
      earningHistoryId: `earning-${n}`,
      amountCents: 1000,
      status: "PENDING",
      freelancerId: `user_${n}`,
      agencyId: null,
      freelancerAccountId: accountId,
      agencyAccountId: null,
    };
  });

const transferredPayoutIds = () =>
  hoisted.transfersCreate.mock.calls.map(
    ([params]) => params.metadata.payoutId,
  );

const warnEvents = () => hoisted.log.warn.mock.calls.map(([entry]) => entry);

const MINUTE = 60_000;

beforeEach(() => {
  hoisted.rows = [];
  hoisted.findCalls = [];
  hoisted.findFails = false;
  hoisted.claimFailsFor.clear();
  hoisted.restrictedAccounts.clear();
  hoisted.onAccountCheck = undefined;
  for (const fn of Object.values(hoisted.log)) {
    fn.mockReset().mockResolvedValue(undefined);
  }
  hoisted.transfersCreate.mockReset();
  hoisted.transfersCreate.mockImplementation(
    async (params: { metadata: { payoutId: string } }) => ({
      id: `tr_${params.metadata.payoutId}`,
    }),
  );
  hoisted.accountsRetrieve.mockReset();
  hoisted.accountsRetrieve.mockImplementation(async (accountId: string) => {
    hoisted.onAccountCheck?.();
    const status = hoisted.restrictedAccounts.has(accountId)
      ? "restricted"
      : "active";
    return {
      configuration: {
        recipient: {
          capabilities: { stripe_balance: { stripe_transfers: { status } } },
        },
      },
    };
  });
});

afterEach(() => {
  vi.useRealTimers();
});

describe("bounded payout run", () => {
  it("uses the decided limits", () => {
    expect(PAYOUT_BATCH_SIZE).toBe(50);
    expect(PAYOUT_MAX_PER_TICK).toBe(500);
    expect(PAYOUT_TICK_BUDGET_MS).toBe(45 * MINUTE);
  });

  it("processes 120 candidates in 3 keyset batches, each exactly once", async () => {
    hoisted.rows = makeRows(120);

    const summary = await processDuePayouts();

    expect(summary).toEqual({
      checked: 120,
      paid: 120,
      skipped: 0,
      failed: 0,
      stoppedEarly: null,
    });
    expect(hoisted.findCalls).toHaveLength(4);
    expect(hoisted.findCalls.map((call) => call.limit)).toEqual([
      50, 50, 50, 50,
    ]);
    expect(hoisted.findCalls[0]!.after).toBeUndefined();
    const at = (index: number) => ({
      createdAt: hoisted.rows[index]!.createdAt,
      id: hoisted.rows[index]!.id,
    });
    expect(hoisted.findCalls.slice(1).map((call) => call.after)).toEqual([
      at(49),
      at(99),
      at(119),
    ]);
    const ids = transferredPayoutIds();
    expect(ids).toEqual(hoisted.rows.map((row) => row.id));
    expect(new Set(ids).size).toBe(120);
  });

  it("stops at the wall-clock budget and reports budget", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));
    hoisted.onAccountCheck = () => {
      vi.setSystemTime(Date.now() + 10 * MINUTE);
    };
    hoisted.rows = makeRows(20);

    const summary = await processDuePayouts();

    expect(summary.checked).toBe(5);
    expect(summary.paid).toBe(5);
    expect(summary.stoppedEarly).toBe("budget");
    expect(transferredPayoutIds()).toEqual(
      hoisted.rows.slice(0, 5).map((row) => row.id),
    );
    expect(warnEvents()).toContainEqual(
      expect.objectContaining({
        eventName: "payout.run.budget_exhausted",
        attributes: { "payout.processed": 5 },
      }),
    );
    expect(hoisted.findCalls).toHaveLength(1);
  });

  it("stops at the per-tick cap and logs payout.run.capped", async () => {
    hoisted.rows = makeRows(PAYOUT_MAX_PER_TICK + 20);

    const summary = await processDuePayouts();

    expect(summary.checked).toBe(PAYOUT_MAX_PER_TICK);
    expect(summary.paid).toBe(PAYOUT_MAX_PER_TICK);
    expect(summary.stoppedEarly).toBe("cap");
    expect(new Set(transferredPayoutIds()).size).toBe(PAYOUT_MAX_PER_TICK);
    expect(warnEvents()).toContainEqual(
      expect.objectContaining({
        eventName: "payout.run.capped",
        attributes: {
          "payout.processed": PAYOUT_MAX_PER_TICK,
          "payout.cap": PAYOUT_MAX_PER_TICK,
        },
      }),
    );
  });

  it("does not report a cap when exactly the cap of candidates exists", async () => {
    hoisted.rows = makeRows(PAYOUT_MAX_PER_TICK);

    const summary = await processDuePayouts();

    expect(summary.checked).toBe(PAYOUT_MAX_PER_TICK);
    expect(summary.stoppedEarly).toBeNull();
    expect(
      warnEvents().filter((entry) => entry.eventName === "payout.run.capped"),
    ).toHaveLength(0);
  });

  it("keeps going after a candidate throws, across batch boundaries", async () => {
    hoisted.rows = makeRows(60);
    hoisted.claimFailsFor.add(hoisted.rows[2]!.id);
    hoisted.claimFailsFor.add(hoisted.rows[49]!.id);

    const summary = await processDuePayouts();

    expect(summary).toEqual({
      checked: 60,
      paid: 58,
      skipped: 0,
      failed: 2,
      stoppedEarly: null,
    });
    expect(hoisted.findCalls[1]!.after).toEqual({
      createdAt: hoisted.rows[49]!.createdAt,
      id: hoisted.rows[49]!.id,
    });
    const failedEvents = hoisted.log.error.mock.calls.filter(
      ([entry]) => entry.eventName === "payout.failed",
    );
    expect(failedEvents).toHaveLength(2);
  });

  it("pays newer rows behind more than one batch of permanently skipped older rows", async () => {
    const skipped = makeRows(PAYOUT_BATCH_SIZE + 10, { restricted: true });
    const payable = makeRows(2, { from: PAYOUT_BATCH_SIZE + 10 });
    hoisted.rows = [...skipped, ...payable];

    const summary = await processDuePayouts();

    expect(summary).toEqual({
      checked: PAYOUT_BATCH_SIZE + 12,
      paid: 2,
      skipped: PAYOUT_BATCH_SIZE + 10,
      failed: 0,
      stoppedEarly: null,
    });
    expect(transferredPayoutIds()).toEqual(payable.map((row) => row.id));
  });

  it("logs payout.run.failed and rethrows when creating due rows fails", async () => {
    vi.mocked(insertPendingPayoutsForDueEarnings).mockRejectedValueOnce(
      new Error("insert failed"),
    );
    hoisted.rows = makeRows(1);

    await expect(processDuePayouts()).rejects.toThrow("insert failed");

    expect(hoisted.findCalls).toHaveLength(0);
    expect(transferredPayoutIds()).toHaveLength(0);
    expect(
      hoisted.log.error.mock.calls.filter(
        ([entry]) => entry.eventName === "payout.run.failed",
      ),
    ).toHaveLength(1);
  });

  it("logs payout.run.failed and rethrows when the candidate read fails", async () => {
    hoisted.rows = makeRows(1);
    hoisted.findFails = true;

    await expect(processDuePayouts()).rejects.toThrow("db down");

    expect(transferredPayoutIds()).toHaveLength(0);
    const runFailed = hoisted.log.error.mock.calls.filter(
      ([entry]) => entry.eventName === "payout.run.failed",
    );
    expect(runFailed).toHaveLength(1);
  });
});
