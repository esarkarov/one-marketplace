import { randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
  type MockInstance,
} from "vitest";

const mocks = vi.hoisted(() => ({
  transfersCreate: vi.fn(),
  transfersList: vi.fn(),
  accountsRetrieve: vi.fn(),
  sendNotification: vi.fn(),
}));

vi.mock("../../config/stripe.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../config/stripe.js")>()),
  stripe: {
    transfers: { create: mocks.transfersCreate, list: mocks.transfersList },
    v2: { core: { accounts: { retrieve: mocks.accountsRetrieve } } },
  },
}));

vi.mock("../../events/publisher.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../events/publisher.js")>()),
  sendNotification: mocks.sendNotification,
}));

import { logger } from "../../config/logger.js";
import { db, pool } from "../../database/client.js";
import { accounts, payout_history } from "../../database/schema.js";
import { assertTestDatabase } from "../../test/assert-test-database.js";
import { fakeStripeKey } from "../../test/fake-secrets.js";
import {
  assertPayoutSchema,
  countLeftovers,
  createTestData,
  findPayoutsByEarning,
  purgeLeftovers,
  readPayout,
  secondsUntilRetry,
  timeTravel,
} from "../../test/factories.js";
import { uuidV5 } from "../../utils/uuid-v5.js";
import {
  getAdminOverviewTotals,
  getAdminTransactions,
} from "../admin/admin.service.js";
import { getAgencyEarningsOverview } from "../agency/agency.service.js";
import { getFreelancerEarningsOverview } from "../freelancer/freelancer.service.js";
import { RETRY_BACKOFF_SECONDS } from "./payout-failure.js";
import {
  PayoutTransitionError,
  transitionPayout,
  type PayoutStatus,
} from "./payout-state.js";
import { processDuePayouts } from "./payouts.service.js";

type LogEntry = {
  level: "info" | "warn" | "error";
  message: string;
  eventName?: string;
  attributes?: Record<string, unknown>;
};

type StripeTransferLike = {
  id: string;
  amount: number;
  currency: string;
  destination: string;
  reversed?: boolean;
  amount_reversed?: number;
};

const activeAccount = {
  configuration: {
    recipient: {
      capabilities: {
        stripe_balance: { stripe_transfers: { status: "active" } },
      },
    },
  },
};

const restrictedAccount = {
  configuration: {
    recipient: {
      capabilities: {
        stripe_balance: { stripe_transfers: { status: "restricted" } },
      },
    },
  },
};

const FAKE_SECRET = fakeStripeKey("live", "FAKESECRET0123456789");

let data: ReturnType<typeof createTestData>;
let logs: LogEntry[];
let spies: MockInstance[];
let transferScripts: Map<string, Array<Error | "ok">>;
let existingTransfers: Map<string, StripeTransferLike[]>;
let accountBehaviour: Map<string, "restricted" | Error>;

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const stripeError = (
  type: string,
  code: string | undefined,
  statusCode: number | undefined,
  message = "stripe failure",
) => Object.assign(new Error(message), { type, code, statusCode });

const createCallsFor = (payoutId: string) =>
  mocks.transfersCreate.mock.calls.filter(
    ([params]) => params.transfer_group === `payout:${payoutId}`,
  );

const createOrdersFor = (payoutId: string) =>
  mocks.transfersCreate.mock.calls.flatMap(([params], index) =>
    params.transfer_group === `payout:${payoutId}`
      ? [mocks.transfersCreate.mock.invocationCallOrder[index]!]
      : [],
  );

const listCallsFor = (payoutId: string) =>
  mocks.transfersList.mock.calls.filter(
    ([params]) => params.transfer_group === `payout:${payoutId}`,
  );

const listOrdersFor = (payoutId: string) =>
  mocks.transfersList.mock.calls.flatMap(([params], index) =>
    params.transfer_group === `payout:${payoutId}`
      ? [mocks.transfersList.mock.invocationCallOrder[index]!]
      : [],
  );

const stripeCallCount = (payoutId: string) =>
  createCallsFor(payoutId).length + listCallsFor(payoutId).length;

const keysFor = (payoutId: string) =>
  createCallsFor(payoutId).map(([, options]) => options.idempotencyKey);

const retrieveCallsFor = (accountId: string) =>
  mocks.accountsRetrieve.mock.calls.filter(([id]) => id === accountId);

const notificationsFor = (payoutId: string) =>
  mocks.sendNotification.mock.calls.filter(
    ([input]) => input.eventId === uuidV5(payoutId),
  );

const logsFor = (payoutId: string) =>
  logs.filter((entry) => entry.attributes?.["payout.id"] === payoutId);

const eventsFor = (payoutId: string, eventName: string) =>
  logsFor(payoutId).filter((entry) => entry.eventName === eventName);

const pgCode = (error: unknown): string | undefined => {
  const source = error as { code?: string; cause?: { code?: string } };
  return source.code ?? source.cause?.code;
};

const pgConstraint = (error: unknown): string | undefined => {
  const source = error as {
    constraint?: string;
    cause?: { constraint?: string };
  };
  return source.constraint ?? source.cause?.constraint;
};

const expectRejectsWith = async (
  promise: Promise<unknown>,
  code: string,
  constraint?: string,
) => {
  const error = await promise.then(
    () => undefined,
    (caught: unknown) => caught,
  );
  expect(error).toBeDefined();
  expect(pgCode(error)).toBe(code);
  if (constraint) expect(pgConstraint(error)).toBe(constraint);
};

const claimInput = (id: string, destination: string) => ({
  id,
  to: "PROCESSING" as const,
  set: {
    attempts: sql`${payout_history.attempts} + 1`,
    claimed_at: sql`now()`,
    next_retry_at: null,
    destination_account_id: destination,
    idempotency_key: sql`COALESCE(${payout_history.idempotency_key}, 'payout:' || ${payout_history.id}::text || ':1')`,
  },
});

beforeAll(async () => {
  assertTestDatabase(process.env.DATABASE_URL, process.env.POSTGRES_DB);
  await assertPayoutSchema();
  await purgeLeftovers();
});

afterAll(async () => {
  const leftovers = await countLeftovers();
  await pool.end();
  expect(leftovers).toBe(0);
});

beforeEach(() => {
  data = createTestData();
  logs = [];
  transferScripts = new Map();
  existingTransfers = new Map();
  accountBehaviour = new Map();

  mocks.transfersCreate.mockReset();
  mocks.transfersCreate.mockImplementation(
    async (params: { metadata: { payoutId: string } }) => {
      await delay(15);
      const next = transferScripts.get(params.metadata.payoutId)?.shift();
      if (next && next !== "ok") throw next;
      return { id: `tr_it_${randomUUID()}` };
    },
  );

  mocks.transfersList.mockReset();
  mocks.transfersList.mockImplementation(
    async (params: { transfer_group: string }) => ({
      data: existingTransfers.get(params.transfer_group) ?? [],
    }),
  );

  mocks.accountsRetrieve.mockReset();
  mocks.accountsRetrieve.mockImplementation(async (accountId: string) => {
    const behaviour = accountBehaviour.get(accountId);
    if (behaviour instanceof Error) throw behaviour;
    return behaviour === "restricted" ? restrictedAccount : activeAccount;
  });

  mocks.sendNotification.mockReset();
  mocks.sendNotification.mockResolvedValue("published");

  spies = (["info", "warn", "error"] as const).map((level) =>
    vi.spyOn(logger, level).mockImplementation((payload) => {
      logs.push({ level, ...payload });
      return Promise.resolve();
    }),
  );
});

afterEach(async () => {
  for (const spy of spies) spy.mockRestore();
  await data.cleanup();
});

describe("payout flow against real Postgres", () => {
  it("lets exactly one of many concurrent claims win each payout", async () => {
    const fixtures = await Promise.all(
      Array.from({ length: 5 }, () => data.createPayoutFixture()),
    );

    const results = await Promise.all(
      fixtures.flatMap((fixture) => [
        transitionPayout(
          claimInput(fixture.payoutId!, fixture.connectAccountId!),
        ),
        transitionPayout(
          claimInput(fixture.payoutId!, fixture.connectAccountId!),
        ),
      ]),
    );

    expect(results.filter(Boolean)).toHaveLength(5);
    for (const [index, fixture] of fixtures.entries()) {
      const winners = [results[index * 2], results[index * 2 + 1]].filter(
        Boolean,
      );
      expect(winners).toHaveLength(1);
      const row = await readPayout(fixture.payoutId!);
      expect(row).toMatchObject({
        status: "PROCESSING",
        attempts: 1,
        idempotency_key: `payout:${fixture.payoutId}:1`,
        destination_account_id: fixture.connectAccountId,
      });
      expect(row!.claimed_at).not.toBeNull();
    }
    expect(mocks.transfersCreate).not.toHaveBeenCalled();
  });

  it("creates exactly one transfer when two cron runs race over one payout", async () => {
    const fixture = await data.createPayoutFixture();
    const id = fixture.payoutId!;

    await Promise.all([processDuePayouts(), processDuePayouts()]);

    expect(createCallsFor(id)).toHaveLength(1);
    expect(listCallsFor(id)).toHaveLength(0);
    const row = await readPayout(id);
    expect(row).toMatchObject({
      status: "PAID",
      attempts: 1,
      idempotency_key: `payout:${id}:1`,
      last_error: null,
      next_retry_at: null,
    });
    expect(row!.stripe_transfer_id).toMatch(/^tr_it_/);
    expect(row!.paid_at).not.toBeNull();
    expect(notificationsFor(id)).toHaveLength(1);
  });

  describe("crash between claim and the Stripe call", () => {
    it("takes over a stale claim, lists by transfer group, then creates once with the same key", async () => {
      const fixture = await data.createPayoutFixture({
        payout: {
          status: "PROCESSING",
          attempts: 1,
          claimedMinutesAgo: 20,
          idempotencyKey: "placeholder",
        },
      });
      const id = fixture.payoutId!;
      await db
        .update(payout_history)
        .set({ idempotency_key: `payout:${id}:1` })
        .where(eq(payout_history.id, id));

      await processDuePayouts();

      expect(listCallsFor(id)).toHaveLength(1);
      expect(listCallsFor(id)[0]![0]).toMatchObject({
        transfer_group: `payout:${id}`,
        destination: fixture.connectAccountId,
      });
      expect(createCallsFor(id)).toHaveLength(1);
      expect(keysFor(id)).toEqual([`payout:${id}:1`]);
      expect(listOrdersFor(id)[0]).toBeLessThan(createOrdersFor(id)[0]!);

      const row = await readPayout(id);
      expect(row).toMatchObject({
        status: "PAID",
        attempts: 2,
        idempotency_key: `payout:${id}:1`,
        destination_account_id: fixture.connectAccountId,
      });
      expect(row!.stripe_transfer_id).toMatch(/^tr_it_/);
      expect(eventsFor(id, "payout.recovered")[0]?.attributes?.reason).toBe(
        "stuck_takeover",
      );
      expect(notificationsFor(id)).toHaveLength(1);
    });

    it("adopts a transfer that already exists instead of paying twice", async () => {
      const fixture = await data.createPayoutFixture({
        payout: { status: "PROCESSING", attempts: 1, claimedMinutesAgo: 20 },
      });
      const id = fixture.payoutId!;
      const existing = {
        id: `tr_it_existing_${randomUUID()}`,
        amount: 10000,
        currency: "usd",
        destination: fixture.connectAccountId!,
      };
      existingTransfers.set(`payout:${id}`, [existing]);

      await processDuePayouts();

      expect(listCallsFor(id)).toHaveLength(1);
      expect(createCallsFor(id)).toHaveLength(0);
      const row = await readPayout(id);
      expect(row).toMatchObject({
        status: "PAID",
        attempts: 2,
        stripe_transfer_id: existing.id,
        idempotency_key: `payout:${id}:1`,
      });
      const recovered = eventsFor(id, "payout.recovered");
      expect(
        recovered.some(
          (entry) => entry.attributes?.reason === "adopted_transfer",
        ),
      ).toBe(true);
      expect(notificationsFor(id)).toHaveLength(1);
      expect(notificationsFor(id)[0]![0].metadata.stripeTransferId).toBe(
        existing.id,
      );
    });

    it("does not adopt a listed transfer with a different amount", async () => {
      const fixture = await data.createPayoutFixture({
        payout: { status: "PROCESSING", attempts: 1, claimedMinutesAgo: 20 },
      });
      const id = fixture.payoutId!;
      existingTransfers.set(`payout:${id}`, [
        {
          id: "tr_it_other_amount",
          amount: 5,
          currency: "usd",
          destination: fixture.connectAccountId!,
        },
      ]);

      await processDuePayouts();

      expect(createCallsFor(id)).toHaveLength(1);
      const row = await readPayout(id);
      expect(row!.status).toBe("PAID");
      expect(row!.stripe_transfer_id).not.toBe("tr_it_other_amount");
    });
  });

  it("does not take over a claim younger than 15 minutes", async () => {
    const fixture = await data.createPayoutFixture({
      payout: {
        status: "PROCESSING",
        attempts: 1,
        claimedMinutesAgo: 14,
        idempotencyKey: "payout:fresh:1",
      },
    });
    const id = fixture.payoutId!;
    const before = await readPayout(id);

    await processDuePayouts();

    expect(stripeCallCount(id)).toBe(0);
    expect(retrieveCallsFor(fixture.connectAccountId!)).toHaveLength(0);
    expect(await readPayout(id)).toEqual(before);
  });

  describe("definitive Stripe failure", () => {
    it("fails with a bumped key, redacted error and a future retry, then pays once with the new key", async () => {
      const fixture = await data.createPayoutFixture();
      const id = fixture.payoutId!;
      transferScripts.set(id, [
        stripeError(
          "StripeInvalidRequestError",
          "parameter_invalid",
          400,
          `Invalid parameter ${FAKE_SECRET}`,
        ),
      ]);

      await processDuePayouts();

      const failed = await readPayout(id);
      expect(failed).toMatchObject({
        status: "FAILED",
        attempts: 1,
        idempotency_key: `payout:${id}:2`,
        last_error: "StripeInvalidRequestError:parameter_invalid",
        stripe_transfer_id: null,
      });
      expect(failed!.next_retry_at).not.toBeNull();
      const seconds = await secondsUntilRetry(id);
      expect(seconds).toBeGreaterThan(RETRY_BACKOFF_SECONDS[0] - 30);
      expect(seconds).toBeLessThanOrEqual(RETRY_BACKOFF_SECONDS[0]);
      expect(JSON.stringify(failed)).not.toContain(FAKE_SECRET);
      expect(JSON.stringify(logs)).not.toContain(FAKE_SECRET);
      expect(notificationsFor(id)).toHaveLength(0);
      expect(keysFor(id)).toEqual([`payout:${id}:1`]);

      const callsBefore = stripeCallCount(id);
      await processDuePayouts();
      expect(stripeCallCount(id)).toBe(callsBefore);
      expect((await readPayout(id))!.attempts).toBe(1);

      await timeTravel(id, { nextRetryInSeconds: -60 });
      await processDuePayouts();

      expect(keysFor(id)).toEqual([`payout:${id}:1`, `payout:${id}:2`]);
      const paid = await readPayout(id);
      expect(paid).toMatchObject({
        status: "PAID",
        attempts: 2,
        last_error: null,
        next_retry_at: null,
      });
      expect(paid!.stripe_transfer_id).toMatch(/^tr_it_/);
      expect(notificationsFor(id)).toHaveLength(1);
      expect(JSON.stringify(logs)).not.toContain(FAKE_SECRET);
    });
  });

  describe("unknown Stripe outcome", () => {
    it.each([
      [
        "a network error",
        () => new Error(`socket hang up ${FAKE_SECRET}`),
        "Error",
      ],
      [
        "a connection error",
        () => stripeError("StripeConnectionError", undefined, undefined),
        "StripeConnectionError",
      ],
      [
        "a 500",
        () => stripeError("StripeAPIError", undefined, 500),
        "StripeAPIError",
      ],
      [
        "a 429",
        () => stripeError("StripeRateLimitError", "rate_limit", 429),
        "rate_limit",
      ],
      [
        "an idempotency_key_in_use 409",
        () =>
          stripeError("StripeIdempotencyError", "idempotency_key_in_use", 409),
        "idempotency_key_in_use",
      ],
      [
        "an idempotency parameter mismatch 400",
        () => stripeError("StripeIdempotencyError", "idempotency_error", 400),
        "idempotency_error",
      ],
    ])(
      "keeps the key after %s and lists before retrying with the same key",
      async (_label, makeError, expectedCode) => {
        const fixture = await data.createPayoutFixture();
        const id = fixture.payoutId!;
        transferScripts.set(id, [makeError()]);

        await processDuePayouts();

        const failed = await readPayout(id);
        expect(failed).toMatchObject({
          status: "FAILED",
          attempts: 1,
          idempotency_key: `payout:${id}:1`,
          last_error: expectedCode,
        });
        expect(failed!.next_retry_at).not.toBeNull();
        expect(JSON.stringify(failed)).not.toContain(FAKE_SECRET);
        expect(JSON.stringify(logs)).not.toContain(FAKE_SECRET);
        expect(listCallsFor(id)).toHaveLength(0);
        expect(notificationsFor(id)).toHaveLength(0);

        await timeTravel(id, { nextRetryInSeconds: -1 });
        await processDuePayouts();

        expect(listCallsFor(id)).toHaveLength(1);
        expect(createCallsFor(id)).toHaveLength(2);
        expect(keysFor(id)).toEqual([`payout:${id}:1`, `payout:${id}:1`]);
        expect(listOrdersFor(id)[0]).toBeGreaterThan(createOrdersFor(id)[0]!);
        expect(listOrdersFor(id)[0]).toBeLessThan(createOrdersFor(id)[1]!);
        const paid = await readPayout(id);
        expect(paid).toMatchObject({ status: "PAID", attempts: 2 });
        expect(notificationsFor(id)).toHaveLength(1);
      },
    );
  });

  describe("destination change after an unknown outcome", () => {
    const oldDestination = () => `acct_it_old_${randomUUID()}`;

    it("parks the payout for review without creating when no transfer is found", async () => {
      const old = oldDestination();
      const fixture = await data.createPayoutFixture({
        payout: {
          status: "PROCESSING",
          attempts: 1,
          claimedMinutesAgo: 20,
          idempotencyKey: "placeholder",
          destinationAccountId: old,
        },
      });
      const id = fixture.payoutId!;

      await processDuePayouts();

      expect(createCallsFor(id)).toHaveLength(0);
      expect(listCallsFor(id)).toHaveLength(1);
      expect(listCallsFor(id)[0]![0]).not.toHaveProperty("destination");
      expect(await readPayout(id)).toMatchObject({
        status: "FAILED",
        attempts: 2,
        next_retry_at: null,
        last_error: "destination_changed",
        destination_account_id: old,
        stripe_transfer_id: null,
        idempotency_key: "placeholder",
      });
      const exhausted = eventsFor(id, "payout.exhausted");
      expect(exhausted).toHaveLength(1);
      expect(exhausted[0]!.level).toBe("error");
      expect(exhausted[0]!.attributes?.reason).toBe("destination_changed");
      expect(notificationsFor(id)).toHaveLength(0);

      await processDuePayouts();
      expect(createCallsFor(id)).toHaveLength(0);
    });

    it("adopts a transfer that exists under the old destination", async () => {
      const old = oldDestination();
      const fixture = await data.createPayoutFixture({
        payout: {
          status: "PROCESSING",
          attempts: 1,
          claimedMinutesAgo: 20,
          idempotencyKey: "placeholder",
          destinationAccountId: old,
        },
      });
      const id = fixture.payoutId!;
      const existing = {
        id: `tr_it_old_dest_${randomUUID()}`,
        amount: 10000,
        currency: "usd",
        destination: old,
      };
      existingTransfers.set(`payout:${id}`, [existing]);

      await processDuePayouts();

      expect(createCallsFor(id)).toHaveLength(0);
      expect(listCallsFor(id)[0]![0]).not.toHaveProperty("destination");
      expect(await readPayout(id)).toMatchObject({
        status: "PAID",
        stripe_transfer_id: existing.id,
        destination_account_id: old,
      });
      expect(
        eventsFor(id, "payout.recovered").some(
          (entry) =>
            entry.attributes?.reason === "adopted_transfer_other_destination",
        ),
      ).toBe(true);
      expect(notificationsFor(id)).toHaveLength(1);
    });

    it("keeps the first destination on later claims", async () => {
      const fixture = await data.createPayoutFixture();
      const id = fixture.payoutId!;
      transferScripts.set(id, [
        stripeError("StripeConnectionError", undefined, undefined),
      ]);

      await processDuePayouts();

      expect((await readPayout(id))!.destination_account_id).toBe(
        fixture.connectAccountId,
      );
    });
  });

  describe("adoption gate", () => {
    it("lists before creating when attempts were reset to 0 but a previous claim exists", async () => {
      const fixture = await data.createPayoutFixture({
        payout: {
          status: "FAILED",
          attempts: 0,
          claimedMinutesAgo: 120,
          nextRetryInSeconds: -60,
          idempotencyKey: "placeholder",
        },
      });
      const id = fixture.payoutId!;

      await processDuePayouts();

      expect(listCallsFor(id)).toHaveLength(1);
      expect(createCallsFor(id)).toHaveLength(1);
      expect(listOrdersFor(id)[0]).toBeLessThan(createOrdersFor(id)[0]!);
      expect(keysFor(id)).toEqual(["placeholder"]);
      expect(await readPayout(id)).toMatchObject({
        status: "PAID",
        attempts: 1,
      });
    });

    it("does not list on a first claim", async () => {
      const fixture = await data.createPayoutFixture();

      await processDuePayouts();

      expect(listCallsFor(fixture.payoutId!)).toHaveLength(0);
    });
  });

  describe("list errors", () => {
    it.each([
      ["a 400", () => stripeError("StripeInvalidRequestError", "bad", 400)],
      ["a 403", () => stripeError("StripePermissionError", undefined, 403)],
      ["a 500", () => stripeError("StripeAPIError", undefined, 500)],
    ])(
      "never bumps the key when listing fails with %s",
      async (_label, makeError) => {
        const fixture = await data.createPayoutFixture({
          payout: {
            status: "FAILED",
            attempts: 1,
            claimedMinutesAgo: 120,
            nextRetryInSeconds: -60,
            idempotencyKey: "placeholder",
          },
        });
        const id = fixture.payoutId!;
        mocks.transfersList.mockRejectedValueOnce(makeError());

        await processDuePayouts();

        expect(listCallsFor(id)).toHaveLength(1);
        expect(createCallsFor(id)).toHaveLength(0);
        const failed = await readPayout(id);
        expect(failed).toMatchObject({
          status: "FAILED",
          attempts: 2,
          idempotency_key: "placeholder",
        });
        expect(failed!.next_retry_at).not.toBeNull();
        const seconds = await secondsUntilRetry(id);
        expect(seconds).toBeGreaterThan(RETRY_BACKOFF_SECONDS[1] - 30);
        expect(seconds).toBeLessThanOrEqual(RETRY_BACKOFF_SECONDS[1]);
        expect(eventsFor(id, "payout.failed")[0]!.attributes).toMatchObject({
          "payout.failure_kind": "unknown",
        });
      },
    );
  });

  describe("reversed transfers", () => {
    it.each([
      ["reversed flag", { reversed: true }],
      ["amount_reversed", { amount_reversed: 100 }],
    ])(
      "parks instead of adopting a transfer with %s",
      async (_label, extra) => {
        const fixture = await data.createPayoutFixture({
          payout: { status: "PROCESSING", attempts: 1, claimedMinutesAgo: 20 },
        });
        const id = fixture.payoutId!;
        existingTransfers.set(`payout:${id}`, [
          {
            id: `tr_it_reversed_${randomUUID()}`,
            amount: 10000,
            currency: "usd",
            destination: fixture.connectAccountId!,
            ...extra,
          },
        ]);

        await processDuePayouts();

        expect(createCallsFor(id)).toHaveLength(0);
        expect(await readPayout(id)).toMatchObject({
          status: "FAILED",
          next_retry_at: null,
          last_error: "transfer_reversed",
          stripe_transfer_id: null,
        });
        expect(eventsFor(id, "payout.exhausted")[0]!.attributes?.reason).toBe(
          "transfer_reversed",
        );
        expect(notificationsFor(id)).toHaveLength(0);
      },
    );
  });

  it("stops retrying after the fifth failed attempt", async () => {
    const fixture = await data.createPayoutFixture();
    const id = fixture.payoutId!;
    transferScripts.set(
      id,
      Array.from({ length: 5 }, () =>
        stripeError("StripeConnectionError", undefined, undefined),
      ),
    );

    for (let attempt = 1; attempt <= 5; attempt++) {
      await processDuePayouts();
      const row = await readPayout(id);
      expect(row).toMatchObject({
        status: "FAILED",
        attempts: attempt,
        idempotency_key: `payout:${id}:1`,
      });
      if (attempt < 5) {
        const expected = RETRY_BACKOFF_SECONDS[attempt - 1]!;
        const seconds = await secondsUntilRetry(id);
        expect(seconds).toBeGreaterThan(expected - 30);
        expect(seconds).toBeLessThanOrEqual(expected);
        expect(eventsFor(id, "payout.exhausted")).toHaveLength(0);
        await timeTravel(id, { nextRetryInSeconds: -1 });
      }
    }

    const exhausted = await readPayout(id);
    expect(exhausted!.next_retry_at).toBeNull();
    const exhaustedLogs = eventsFor(id, "payout.exhausted");
    expect(exhaustedLogs).toHaveLength(1);
    expect(exhaustedLogs[0]!.level).toBe("error");
    expect(exhaustedLogs[0]!.attributes?.["payout.attempts"]).toBe(5);

    const callsBefore = stripeCallCount(id);
    await processDuePayouts();
    await Promise.all([processDuePayouts(), processDuePayouts()]);
    expect(stripeCallCount(id)).toBe(callsBefore);
    expect(await readPayout(id)).toMatchObject({
      status: "FAILED",
      attempts: 5,
      next_retry_at: null,
    });
    expect(notificationsFor(id)).toHaveLength(0);
  });

  it("creates rows from due earnings and pays each exactly once when cron runs twice in parallel", async () => {
    const fixtures = await Promise.all([
      data.createPayoutFixture({ payout: null }),
      data.createPayoutFixture({ payout: null }),
      data.createPayoutFixture({ payout: null, owner: "agency" }),
      data.createPayoutFixture({ payout: null, owner: "agency" }),
    ]);

    await Promise.all([processDuePayouts(), processDuePayouts()]);

    const payoutIds: string[] = [];
    for (const fixture of fixtures) {
      const rows = await findPayoutsByEarning(fixture.earningId);
      expect(rows).toHaveLength(1);
      const row = rows[0]!;
      payoutIds.push(row.id);

      expect(row).toMatchObject({
        status: "PAID",
        amount: "100.00",
        attempts: 1,
        idempotency_key: `payout:${row.id}:1`,
        destination_account_id: fixture.connectAccountId,
      });
      expect(row.notified_at).not.toBeNull();
      expect(row.paid_at).not.toBeNull();

      const creates = createCallsFor(row.id);
      expect(creates).toHaveLength(1);
      expect(creates[0]![0]).toMatchObject({
        amount: 10000,
        currency: "usd",
        destination: fixture.connectAccountId,
        transfer_group: `payout:${row.id}`,
        metadata: expect.objectContaining({
          payoutId: row.id,
          earningHistoryId: fixture.earningId,
        }),
      });
      expect(creates[0]![1]).toEqual({ idempotencyKey: `payout:${row.id}:1` });

      const notifications = notificationsFor(row.id);
      expect(notifications).toHaveLength(1);
      const [input] = notifications[0]!;
      expect(input).toMatchObject({
        type: "PAYOUT_COMPLETED",
        eventId: uuidV5(row.id),
        metadata: {
          earningHistoryId: fixture.earningId,
          amount: 100,
          stripeTransferId: row.stripe_transfer_id,
        },
      });
      if (fixture.owner.freelancerId) {
        expect(input.recipientId).toBe(fixture.owner.freelancerId);
      } else {
        expect(input.agencyId).toBe(fixture.owner.agencyId);
      }
    }

    const mine = new Set(payoutIds.map((id) => uuidV5(id)));
    const sentIds = mocks.sendNotification.mock.calls
      .map(([input]) => input.eventId as string)
      .filter((eventId) => mine.has(eventId));
    expect(sentIds).toHaveLength(payoutIds.length);
    expect(new Set(sentIds).size).toBe(sentIds.length);
  });

  it("creates PENDING rows only for old enough earnings with positive net, and rounds odd cents", async () => {
    const odd = await data.createPayoutFixture({
      payout: null,
      earning: { amount: "110.50", fee: "10.25" },
    });
    const young = await data.createPayoutFixture({
      payout: null,
      earning: { ageMs: 24 * 60 * 60 * 1000 },
    });
    const zeroNet = await data.createPayoutFixture({
      payout: null,
      earning: { amount: "10.00", fee: "10.00" },
    });

    await processDuePayouts();
    await processDuePayouts();

    const oddRows = await findPayoutsByEarning(odd.earningId);
    expect(oddRows).toHaveLength(1);
    expect(oddRows[0]).toMatchObject({ amount: "100.25", status: "PAID" });
    expect(createCallsFor(oddRows[0]!.id)[0]![0].amount).toBe(10025);

    expect(await findPayoutsByEarning(young.earningId)).toHaveLength(0);
    expect(await findPayoutsByEarning(zeroNet.earningId)).toHaveLength(0);
    const skipped = logs.filter(
      (entry) =>
        entry.attributes?.["earning.id"] === zeroNet.earningId &&
        entry.attributes?.["error.code"] === "non_positive_net_amount",
    );
    expect(skipped.length).toBeGreaterThanOrEqual(1);
    expect(skipped[0]!.level).toBe("warn");
  });

  describe("notification sweep", () => {
    it("notifies a PAID row with notified_at NULL exactly once with the deterministic event id", async () => {
      const fixture = await data.createPayoutFixture({
        payout: { status: "PAID", attempts: 1 },
      });
      const id = fixture.payoutId!;
      expect((await readPayout(id))!.notified_at).toBeNull();

      await processDuePayouts();

      const notifications = notificationsFor(id);
      expect(notifications).toHaveLength(1);
      expect(notifications[0]![0]).toMatchObject({
        type: "PAYOUT_COMPLETED",
        recipientId: fixture.owner.freelancerId,
        eventId: uuidV5(id),
      });
      expect((await readPayout(id))!.notified_at).not.toBeNull();
      expect(stripeCallCount(id)).toBe(0);

      await processDuePayouts();
      expect(notificationsFor(id)).toHaveLength(1);
    });

    it("keeps notified_at NULL while publishing fails and sets it once published", async () => {
      const fixture = await data.createPayoutFixture({
        owner: "agency",
        payout: { status: "PAID", attempts: 1 },
      });
      const id = fixture.payoutId!;
      mocks.sendNotification.mockResolvedValueOnce("failed");

      await processDuePayouts();

      expect(notificationsFor(id)).toHaveLength(1);
      expect((await readPayout(id))!.notified_at).toBeNull();
      expect(
        eventsFor(id, "payment.payout.notification_failed")[0]?.level,
      ).toBe("warn");

      await processDuePayouts();

      expect(notificationsFor(id)).toHaveLength(2);
      expect(notificationsFor(id)[1]![0]).toMatchObject({
        agencyId: fixture.owner.agencyId,
        eventId: uuidV5(id),
      });
      expect((await readPayout(id))!.notified_at).not.toBeNull();

      await processDuePayouts();
      expect(notificationsFor(id)).toHaveLength(2);
    });

    it("leaves notified_at NULL after paying when the first publish fails, then publishes once from the sweep", async () => {
      const fixture = await data.createPayoutFixture();
      const id = fixture.payoutId!;
      mocks.sendNotification.mockResolvedValueOnce("failed");

      await processDuePayouts();

      expect(await readPayout(id)).toMatchObject({
        status: "PAID",
        notified_at: null,
      });
      expect(notificationsFor(id)).toHaveLength(1);

      await processDuePayouts();
      await processDuePayouts();

      expect(notificationsFor(id)).toHaveLength(2);
      expect((await readPayout(id))!.notified_at).not.toBeNull();
      expect(createCallsFor(id)).toHaveLength(1);
    });

    it("sets notified_at when RabbitMQ is disabled and does not resend", async () => {
      const fixture = await data.createPayoutFixture({
        payout: { status: "PAID", attempts: 1 },
      });
      const id = fixture.payoutId!;
      mocks.sendNotification.mockResolvedValue("disabled");

      await processDuePayouts();
      await processDuePayouts();

      expect(notificationsFor(id)).toHaveLength(1);
      expect((await readPayout(id))!.notified_at).not.toBeNull();
    });
  });

  describe("database constraints", () => {
    it("rejects a second payout row for the same earning with 23505", async () => {
      const fixture = await data.createPayoutFixture();

      await expectRejectsWith(
        data.createPayout(fixture.earningId, fixture.owner),
        "23505",
      );
      expect(await findPayoutsByEarning(fixture.earningId)).toHaveLength(1);
    });

    it("enforces the PAID/transfer-id check in both directions", async () => {
      const fixture = await data.createPayoutFixture();
      const id = fixture.payoutId!;

      await expectRejectsWith(
        pool.query("update payout_history set status = 'PAID' where id = $1", [
          id,
        ]),
        "23514",
        "payout_history_paid_has_transfer_check",
      );
      await expectRejectsWith(
        pool.query(
          "update payout_history set stripe_transfer_id = 'tr_it_orphan' where id = $1",
          [id],
        ),
        "23514",
        "payout_history_paid_has_transfer_check",
      );
      await expectRejectsWith(
        pool.query("update payout_history set status = 'BOGUS' where id = $1", [
          id,
        ]),
        "23514",
        "payout_history_status_check",
      );
      await expectRejectsWith(
        pool.query("update payout_history set attempts = -1 where id = $1", [
          id,
        ]),
        "23514",
        "payout_history_attempts_check",
      );
      expect(await readPayout(id)).toMatchObject({
        status: "PENDING",
        stripe_transfer_id: null,
        attempts: 0,
      });
    });
  });

  describe("invalid transitions", () => {
    it.each([
      ["PAID", "PROCESSING"],
      ["PENDING", "PAID"],
      ["FAILED", "PAID"],
    ] as const)(
      "refuses %s -> %s and leaves the row unchanged",
      async (from: PayoutStatus, to: PayoutStatus) => {
        const fixture = await data.createPayoutFixture({
          payout: {
            status: from,
            attempts: 1,
            nextRetryInSeconds: from === "FAILED" ? -60 : undefined,
          },
        });
        const id = fixture.payoutId!;
        const before = await readPayout(id);

        await expect(
          transitionPayout({ id, from, to, set: { last_error: "tampered" } }),
        ).rejects.toBeInstanceOf(PayoutTransitionError);
        expect(await readPayout(id)).toEqual(before);

        const implicit = await transitionPayout({
          id,
          to,
          set: { last_error: "tampered" },
        });
        expect(implicit).toBeUndefined();
        expect(await readPayout(id)).toEqual(before);
      },
    );

    it("refuses PROCESSING -> PAID when the attempt counter moved on", async () => {
      const fixture = await data.createPayoutFixture({
        payout: { status: "PROCESSING", attempts: 2, claimedMinutesAgo: 1 },
      });
      const id = fixture.payoutId!;

      const stale = await transitionPayout({
        id,
        from: "PROCESSING",
        to: "PAID",
        expectedAttempts: 1,
        set: { stripe_transfer_id: "tr_it_stale" },
      });
      expect(stale).toBeUndefined();
      expect((await readPayout(id))!.status).toBe("PROCESSING");

      const current = await transitionPayout({
        id,
        from: "PROCESSING",
        to: "PAID",
        expectedAttempts: 2,
        set: { stripe_transfer_id: `tr_it_${randomUUID()}` },
      });
      expect(current?.status).toBe("PAID");
    });
  });

  describe("amounts", () => {
    it("pays the smallest storable amount of 0.01 as one minor unit", async () => {
      const fixture = await data.createPayoutFixture({
        payout: { amount: "0.01" },
      });
      const id = fixture.payoutId!;

      await processDuePayouts();

      expect(createCallsFor(id)).toHaveLength(1);
      expect(createCallsFor(id)[0]![0].amount).toBe(1);
      expect((await readPayout(id))!.status).toBe("PAID");
    });

    it("cannot store an amount below one minor unit, so invalid_amount is unreachable through the schema", async () => {
      const fixture = await data.createPayoutFixture({ payout: null });

      await expectRejectsWith(
        pool.query(
          "insert into payout_history (freelancer_id, earning_history_id, amount) values ($1, $2, '0.004')",
          [fixture.owner.freelancerId, fixture.earningId],
        ),
        "23514",
        "payout_history_amount_check",
      );
      await expectRejectsWith(
        pool.query(
          "insert into payout_history (freelancer_id, earning_history_id, amount) values ($1, $2, '0')",
          [fixture.owner.freelancerId, fixture.earningId],
        ),
        "23514",
        "payout_history_amount_check",
      );
      expect(await findPayoutsByEarning(fixture.earningId)).toHaveLength(0);
    });
  });

  describe("destination not payable", () => {
    it.each(["freelancer", "agency"] as const)(
      "leaves a %s payout PENDING without a Connect account and pays once one exists",
      async (owner) => {
        const fixture = await data.createPayoutFixture({
          owner,
          connectAccount: false,
        });
        const id = fixture.payoutId!;

        await processDuePayouts();
        await processDuePayouts();

        expect(await readPayout(id)).toMatchObject({
          status: "PENDING",
          attempts: 0,
          claimed_at: null,
          idempotency_key: null,
          destination_account_id: null,
        });
        expect(stripeCallCount(id)).toBe(0);
        expect(notificationsFor(id)).toHaveLength(0);

        const connectAccountId = `acct_it_${randomUUID()}`;
        if (fixture.owner.freelancerId) {
          await db
            .update(accounts)
            .set({ stripe_connect_account_id: connectAccountId })
            .where(eq(accounts.auth_id, fixture.owner.freelancerId));
        } else {
          await pool.query(
            "update agency_metadata set stripe_connect_account_id = $1 where id = $2",
            [connectAccountId, fixture.owner.agencyId],
          );
        }

        await processDuePayouts();

        expect(createCallsFor(id)).toHaveLength(1);
        expect(createCallsFor(id)[0]![0].destination).toBe(connectAccountId);
        expect(await readPayout(id)).toMatchObject({
          status: "PAID",
          attempts: 1,
        });
      },
    );

    it("leaves the payout PENDING while transfers are inactive and re-evaluates on the next run", async () => {
      const fixture = await data.createPayoutFixture();
      const id = fixture.payoutId!;
      accountBehaviour.set(fixture.connectAccountId!, "restricted");

      await processDuePayouts();

      expect(
        retrieveCallsFor(fixture.connectAccountId!).length,
      ).toBeGreaterThanOrEqual(1);
      expect(await readPayout(id)).toMatchObject({
        status: "PENDING",
        attempts: 0,
        claimed_at: null,
      });
      expect(stripeCallCount(id)).toBe(0);

      accountBehaviour.delete(fixture.connectAccountId!);
      await processDuePayouts();

      expect(createCallsFor(id)).toHaveLength(1);
      expect((await readPayout(id))!.status).toBe("PAID");
    });

    it("leaves the payout PENDING and logs when the account lookup fails", async () => {
      const fixture = await data.createPayoutFixture();
      const id = fixture.payoutId!;
      accountBehaviour.set(
        fixture.connectAccountId!,
        stripeError("StripeAPIError", undefined, 500, FAKE_SECRET),
      );

      await processDuePayouts();

      expect(await readPayout(id)).toMatchObject({
        status: "PENDING",
        attempts: 0,
      });
      expect(stripeCallCount(id)).toBe(0);
      expect(
        eventsFor(id, "payment.payout.account_check_failed")[0]?.level,
      ).toBe("error");
      expect(JSON.stringify(logs)).not.toContain(FAKE_SECRET);
    });
  });

  describe("readers count only PAID payouts", () => {
    it("derives withdrawn and totalPaidOut from PAID rows only", async () => {
      const before = await getAdminOverviewTotals();

      const freelancer = await data.createFreelancer();
      const freelancerOwner = { freelancerId: freelancer.authId };
      const agency = await data.createAgency();
      const agencyOwner = { agencyId: agency.agencyId };

      const seedSet = async (
        owner: typeof freelancerOwner | typeof agencyOwner,
      ) => {
        const pendingEarning = await data.createEarning(owner, {
          amount: "110.00",
          fee: "10.00",
        });
        const failedEarning = await data.createEarning(owner, {
          amount: "55.00",
          fee: "5.00",
        });
        const paidEarning = await data.createEarning(owner, {
          amount: "27.50",
          fee: "2.50",
        });
        const pending = await data.createPayout(pendingEarning, owner, {
          status: "PENDING",
          amount: "100.00",
        });
        const failed = await data.createPayout(failedEarning, owner, {
          status: "FAILED",
          amount: "50.00",
          attempts: 1,
          nextRetryInSeconds: 600,
        });
        const paid = await data.createPayout(paidEarning, owner, {
          status: "PAID",
          amount: "25.00",
          attempts: 1,
          notified: true,
        });
        return {
          pendingEarning,
          failedEarning,
          paidEarning,
          pending,
          failed,
          paid,
        };
      };

      const freelancerSet = await seedSet(freelancerOwner);
      const agencySet = await seedSet(agencyOwner);

      const freelancerOverview = await getFreelancerEarningsOverview(
        freelancer.authId,
      );
      expect(freelancerOverview.withdrawn).toBe(25);
      expect(freelancerOverview.available).toBe(150);
      expect(freelancerOverview.pending).toBe(0);
      const byId = new Map(
        freelancerOverview.recentEarnings.map((row) => [row.id, row.status]),
      );
      expect(byId.get(freelancerSet.paidEarning)).toBe("WITHDRAWN");
      expect(byId.get(freelancerSet.pendingEarning)).toBe("AVAILABLE");
      expect(byId.get(freelancerSet.failedEarning)).toBe("AVAILABLE");

      const agencyOverview = await getAgencyEarningsOverview(agency.agencyId);
      expect(agencyOverview.withdrawn).toBe(25);
      expect(agencyOverview.available).toBe(150);
      const agencyById = new Map(
        agencyOverview.recentEarnings.map((row) => [row.id, row.status]),
      );
      expect(agencyById.get(agencySet.paidEarning)).toBe("WITHDRAWN");
      expect(agencyById.get(agencySet.pendingEarning)).toBe("AVAILABLE");
      expect(agencyById.get(agencySet.failedEarning)).toBe("AVAILABLE");

      const after = await getAdminOverviewTotals();
      expect(
        after.volume.totalPaidOut - before.volume.totalPaidOut,
      ).toBeCloseTo(50, 2);

      const paidAt = new Date(Date.now() - 24 * 60 * 60 * 1000);
      const createdAt = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000);
      for (const set of [freelancerSet, agencySet]) {
        await db
          .update(payout_history)
          .set({ paid_at: paidAt, created_at: createdAt })
          .where(eq(payout_history.id, set.paid));
      }

      const transactions = await getAdminTransactions({
        limit: 200,
        offset: 0,
      });
      for (const set of [freelancerSet, agencySet]) {
        const row = transactions.results.find((entry) => entry.id === set.paid);
        expect(row?.createdAt?.getTime()).toBe(paidAt.getTime());
      }
      const payoutRowIds = new Set(
        transactions.results
          .filter((row) => row.type === "PAYOUT")
          .map((row) => row.id),
      );
      for (const set of [freelancerSet, agencySet]) {
        expect(payoutRowIds.has(set.paid)).toBe(true);
        expect(payoutRowIds.has(set.pending)).toBe(false);
        expect(payoutRowIds.has(set.failed)).toBe(false);
      }
    });
  });
});
