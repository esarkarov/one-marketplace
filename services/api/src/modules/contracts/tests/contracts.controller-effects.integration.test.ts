import { randomUUID } from "node:crypto";
import request from "supertest";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

const mocks = vi.hoisted(() => ({
  store: new Map<string, string>(),
  verifyToken: vi.fn(),
  getUser: vi.fn(),
  sendNotification: vi.fn(),
  push: vi.fn(),
  emitConversationUpdate: vi.fn(),
}));

vi.mock("@/config/env.js", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/config/env.js")>();
  return {
    ...original,
    env: {
      ...original.env,
      clerkSecretKey: "sk_test",
      stripeSecretKey: "sk_stripe_test",
      clientDashboard: "http://localhost:3999",
    },
  };
});

vi.mock("@/infrastructure/auth/clerk.client.js", () => ({
  clerk: { users: { getUser: mocks.getUser } },
  verifyToken: mocks.verifyToken,
}));

vi.mock("@/infrastructure/payments/stripe.client.js", () => ({
  stripe: {
    customers: { create: vi.fn() },
    checkout: { sessions: { create: vi.fn() } },
  },
}));

vi.mock("@/infrastructure/storage/image-kit.client.js", () => ({
  imageKit: { files: { upload: vi.fn(), delete: vi.fn() } },
}));

vi.mock("@/infrastructure/cache/redis.client.js", () => ({
  redis: {
    get: async (key: string) => mocks.store.get(key) ?? null,
    expire: async () => true,
    setEx: async (key: string, _ttl: number, value: string) => {
      mocks.store.set(key, value);
      return "OK";
    },
    del: async (keys: string | string[]) => {
      for (const key of Array.isArray(keys) ? keys : [keys]) {
        mocks.store.delete(key);
      }
      return 1;
    },
  },
  connectRedis: async () => undefined,
  disconnectRedis: async () => undefined,
}));

vi.mock(
  "@/infrastructure/events/notification.publisher.js",
  async (importOriginal) => ({
    ...(await importOriginal<
      typeof import("@/infrastructure/events/notification.publisher.js")
    >()),
    sendNotification: mocks.sendNotification,
  }),
);

vi.mock("@/modules/notification-store/index.js", async (importOriginal) => {
  const original =
    await importOriginal<
      typeof import("@/modules/notification-store/index.js")
    >();
  return {
    ...original,
    pushStoredNotification: async (row: Parameters<typeof mocks.push>[0]) => {
      await mocks.push(row);
      await original.pushStoredNotification(row);
    },
  };
});

vi.mock("@/modules/messaging/messaging.socket.js", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("@/modules/messaging/messaging.socket.js")
  >()),
  emitConversationUpdate: mocks.emitConversationUpdate,
}));

import { db, pool } from "@/database/client.js";
import { notificationEventId } from "@/modules/notification-store/index.js";
import {
  accounts,
  agency_members,
  agency_metadata,
  contract_milestones,
  contracts,
  conversation_participants,
  conversations,
  job_posts,
  proposals,
} from "@/test/support/tables.js";
import { assertTestDatabase } from "@/test/setup/assert-test-database.js";

const { app } = await import("@/app.js");

(
  await import("@/modules/notifications/services/notifications.push.service.js")
).registerNotificationsPush();

const PREFIX = "contracts-effects-it-";
const API = "/api/v1/contracts";
const AMOUNT = 20000;
const CONTRACT_TITLE = "Contract title";

const as = (userId: string) => ({ Authorization: `Bearer ${userId}` });
const newAuthId = () => `${PREFIX}${randomUUID()}`;

const insertAccount = async (role: "CLIENT" | "FREELANCER") => {
  const authId = newAuthId();
  await db.insert(accounts).values({
    auth_id: authId,
    email: `${authId}@example.test`,
    display_name: "Test User",
    role,
    identityVerified: true,
    created_at: new Date(),
    updated_at: new Date(),
  });
  return authId;
};

interface MilestoneSeed {
  status: "PENDING" | "ACTIVE" | "COMPLETED";
  funded?: boolean;
  requested?: boolean;
}

const seed = async (
  options: {
    contractStatus?: "PENDING" | "ACTIVE" | "COMPLETED";
    milestones?: MilestoneSeed[];
    agency?: boolean;
  } = {},
) => {
  const seeds = options.milestones ?? [
    { status: "ACTIVE", funded: true, requested: true },
  ];
  const clientId = await insertAccount("CLIENT");
  const ownerId = await insertAccount("FREELANCER");
  let agencyId: string | null = null;
  if (options.agency) {
    const [agency] = await db
      .insert(agency_metadata)
      .values({
        owner_id: ownerId,
        name: `${PREFIX}agency-${randomUUID()}`,
        size: "1-10",
        specialty: "testing",
        overview: "contract effects agency",
      })
      .returning({ id: agency_metadata.id });
    agencyId = agency!.id;
    await db
      .insert(agency_members)
      .values({ agency_id: agencyId, freelancer_id: ownerId, role: "Founder" });
  }

  const [job] = await db
    .insert(job_posts)
    .values({
      client_id: clientId,
      title: "Contract job",
      description: "Contract test job",
      expertise_level: "INTERMEDIATE",
      expected_duration: "1 week",
      total_budget_cents: AMOUNT * seeds.length,
      milestones: [
        {
          id: randomUUID(),
          title: "First milestone",
          budgetCents: AMOUNT,
          dueDate: "2026-12-01",
        },
      ],
    })
    .returning({ id: job_posts.id });

  const [proposal] = await db
    .insert(proposals)
    .values({
      job_id: job!.id,
      sender_id: agencyId ?? ownerId,
      sender_type: agencyId ? "AGENCY" : "FREELANCER",
      cover_letter: "contract test",
      bid_amount_cents: AMOUNT,
      duration: "1 week",
      status: "INTERVIEWED",
    })
    .returning({ id: proposals.id });

  const contractStatus = options.contractStatus ?? "ACTIVE";
  const [contract] = await db
    .insert(contracts)
    .values({
      proposal_id: proposal!.id,
      job_id: job!.id,
      client_id: clientId,
      freelancer_id: agencyId ? null : ownerId,
      agency_id: agencyId,
      title: CONTRACT_TITLE,
      total_amount_cents: AMOUNT * seeds.length,
      status: contractStatus,
      started_at: contractStatus === "PENDING" ? null : new Date(),
      completed_at: contractStatus === "COMPLETED" ? new Date() : null,
    })
    .returning({ id: contracts.id });

  const [conversation] = await db
    .insert(conversations)
    .values({
      proposal_id: proposal!.id,
      job_id: job!.id,
      context_key: `${PREFIX}${randomUUID()}`,
    })
    .returning({ id: conversations.id });
  await db.insert(conversation_participants).values([
    {
      conversation_id: conversation!.id,
      account_id: clientId,
      participant_type: "CLIENT",
    },
    agencyId
      ? {
          conversation_id: conversation!.id,
          agency_id: agencyId,
          participant_type: "AGENCY",
        }
      : {
          conversation_id: conversation!.id,
          account_id: ownerId,
          participant_type: "FREELANCER",
        },
  ]);

  const milestoneRows = await db
    .insert(contract_milestones)
    .values(
      seeds.map((item, position) => ({
        contract_id: contract!.id,
        title: `Milestone ${position + 1}`,
        amount_cents: AMOUNT,
        due_date: "2026-12-01",
        position,
        status: item.status,
        funded_at: item.funded ? new Date() : null,
        payment_requested_at: item.requested ? new Date() : null,
        submission_message: item.requested ? "Work is ready" : null,
        submission_delivery_link: item.requested
          ? "https://example.test/delivery"
          : null,
        completed_at: item.status === "COMPLETED" ? new Date() : null,
      })),
    )
    .returning({
      id: contract_milestones.id,
      position: contract_milestones.position,
    });
  milestoneRows.sort((a, b) => a.position - b.position);

  return {
    clientId,
    ownerId,
    agencyId,
    contractId: contract!.id,
    conversationId: conversation!.id,
    milestoneIds: milestoneRows.map((row) => row.id),
  };
};

type Fixture = Awaited<ReturnType<typeof seed>>;

const purge = async () => {
  const like = `${PREFIX}%`;
  await pool.query("delete from conversations where context_key like $1", [
    like,
  ]);
  await pool.query("delete from contracts where client_id like $1", [like]);
  await pool.query(
    "delete from proposals where job_id in (select id from job_posts where client_id like $1)",
    [like],
  );
  await pool.query("delete from job_posts where client_id like $1", [like]);
  await pool.query("delete from agency_metadata where owner_id like $1", [
    like,
  ]);
  await pool.query("delete from notifications where recipient_id like $1", [
    like,
  ]);
  await pool.query("delete from accounts where auth_id like $1", [like]);
};

const storedNotices = async (fixture: Fixture, type: string) =>
  (
    await pool.query(
      "select recipient_id, agency_id, type, title, message, link, metadata from notifications where type = $1 and metadata->>'contractId' = $2",
      [type, fixture.contractId],
    )
  ).rows as {
    recipient_id: string | null;
    agency_id: string | null;
    type: string;
    title: string;
    message: string;
    link: string;
    metadata: Record<string, string>;
  }[];

const rowState = async (fixture: Fixture) => {
  const contract = await pool.query(
    "select status from contracts where id = $1",
    [fixture.contractId],
  );
  const milestones = await pool.query(
    "select status, payment_requested_at is not null as requested from contract_milestones where contract_id = $1 order by position",
    [fixture.contractId],
  );
  return JSON.stringify({
    contract: contract.rows[0].status,
    milestones: milestones.rows,
  });
};

const watchCommit = (fixture: Fixture) => {
  const seen: string[] = [];
  mocks.emitConversationUpdate.mockImplementation(async () => {
    seen.push(`emit:${await rowState(fixture)}`);
  });
  mocks.sendNotification.mockImplementation(async () => {
    seen.push(`notify:${await rowState(fixture)}`);
  });
  mocks.push.mockImplementation(async () => {
    seen.push(`notify:${await rowState(fixture)}`);
  });
  return seen;
};

const callOrder = () => ({
  emit: mocks.emitConversationUpdate.mock.invocationCallOrder,
  notify: [
    ...mocks.sendNotification.mock.invocationCallOrder,
    ...mocks.push.mock.invocationCallOrder,
  ],
});

const expectEmitBeforeEveryNotification = () => {
  const { emit, notify } = callOrder();
  expect(emit).toHaveLength(1);
  for (const position of notify) expect(emit[0]).toBeLessThan(position!);
};

const accept = (contractId: string, userId: string, scope?: "agency") =>
  request(app)
    .patch(`${API}/${contractId}/accept`)
    .query({ role: "freelancer", ...(scope ? { scope } : {}) })
    .set(as(userId))
    .send({});

const submit = (
  fixture: Fixture,
  userId: string,
  body: Record<string, unknown> = {},
  scope?: "agency",
) =>
  request(app)
    .patch(
      `${API}/${fixture.contractId}/milestones/${fixture.milestoneIds[0]}/submit`,
    )
    .query({ role: "freelancer", ...(scope ? { scope } : {}) })
    .set(as(userId))
    .send({
      submissionMessage: "The milestone work is complete.",
      submissionDeliveryLink: "https://example.test/delivery",
      ...body,
    });

const review = (
  fixture: Fixture,
  action: "APPROVE" | "REQUEST_CHANGES",
  feedback?: string,
) =>
  request(app)
    .patch(
      `${API}/${fixture.contractId}/milestones/${fixture.milestoneIds[0]}/review`,
    )
    .query({ role: "client" })
    .set(as(fixture.clientId))
    .send({ action, ...(feedback === undefined ? {} : { feedback }) });

const finish = (
  contractId: string,
  userId: string,
  role: "client" | "freelancer",
) =>
  request(app)
    .post(`${API}/${contractId}/finish`)
    .query({ role })
    .set(as(userId))
    .send({ rating: 5, comment: "Great collaboration, would hire again." });

const addMilestone = (contractId: string, userId: string, dueDate: string) =>
  request(app)
    .post(`${API}/${contractId}/milestones`)
    .query({ role: "client" })
    .set(as(userId))
    .send({ title: "Extra milestone", amountCents: 15000, dueDate });

beforeAll(async () => {
  assertTestDatabase(process.env.DATABASE_URL, process.env.POSTGRES_DB);
  await purge();
});

afterAll(async () => {
  await purge();
  await pool.end();
});

beforeEach(() => {
  assertTestDatabase(process.env.DATABASE_URL, process.env.POSTGRES_DB);
  mocks.store.clear();
  mocks.verifyToken.mockReset();
  mocks.getUser.mockReset();
  mocks.sendNotification.mockReset();
  mocks.push.mockReset();
  mocks.emitConversationUpdate.mockReset();
  mocks.verifyToken.mockImplementation(async (token: string) => ({
    sub: token,
    sid: `sess_${token}`,
  }));
  mocks.sendNotification.mockResolvedValue(undefined);
  mocks.emitConversationUpdate.mockResolvedValue(undefined);
});

describe("accept offer effects", () => {
  const pending = () =>
    seed({
      contractStatus: "PENDING",
      milestones: [{ status: "PENDING", funded: true }],
    });

  it("emits once, then notifies the client and the freelancer, after the commit", async () => {
    const fixture = await pending();
    const seen = watchCommit(fixture);

    const response = await accept(fixture.contractId, fixture.ownerId);

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      success: true,
      message: "Contract offer accepted.",
      data: { contractId: fixture.contractId, status: "ACTIVE" },
    });
    expect(mocks.emitConversationUpdate).toHaveBeenCalledTimes(1);
    expect(mocks.emitConversationUpdate).toHaveBeenCalledWith(
      fixture.conversationId,
      fixture.ownerId,
    );
    expect(mocks.sendNotification).toHaveBeenCalledTimes(2);
    const link = `/messages?conversationId=${fixture.conversationId}`;
    expect(mocks.sendNotification).toHaveBeenNthCalledWith(1, {
      recipientId: fixture.clientId,
      type: "CONTRACT_ACCEPTED",
      eventId: notificationEventId(
        "CONTRACT_ACCEPTED",
        fixture.contractId,
        "accepted-client",
      ),
      title: "Contract offer accepted",
      message: `The freelancer accepted your offer for “${CONTRACT_TITLE}”.`,
      link,
      metadata: { contractId: fixture.contractId },
    });
    expect(mocks.sendNotification).toHaveBeenNthCalledWith(2, {
      recipientId: fixture.ownerId,
      type: "CONTRACT_ACCEPTED",
      eventId: notificationEventId(
        "CONTRACT_ACCEPTED",
        fixture.contractId,
        "accepted-talent",
      ),
      title: "Contract started",
      message: `Your contract for “${CONTRACT_TITLE}” is now active.`,
      link,
      metadata: { contractId: fixture.contractId },
    });
    expectEmitBeforeEveryNotification();
    expect(seen).toHaveLength(3);
    for (const entry of seen) expect(entry).toContain('"contract":"ACTIVE"');
  });

  it("notifies the agency for the agency scope", async () => {
    const fixture = await seed({
      agency: true,
      contractStatus: "PENDING",
      milestones: [{ status: "PENDING", funded: true }],
    });

    const response = await accept(
      fixture.contractId,
      fixture.ownerId,
      "agency",
    );

    expect(response.status).toBe(200);
    const link = `/messages?conversationId=${fixture.conversationId}`;
    expect(mocks.sendNotification).toHaveBeenCalledTimes(2);
    expect(mocks.sendNotification).toHaveBeenNthCalledWith(1, {
      recipientId: fixture.clientId,
      type: "CONTRACT_ACCEPTED",
      eventId: notificationEventId(
        "CONTRACT_ACCEPTED",
        fixture.contractId,
        "accepted-client",
      ),
      title: "Contract offer accepted",
      message: `The agency accepted your offer for “${CONTRACT_TITLE}”.`,
      link,
      metadata: { contractId: fixture.contractId },
    });
    expect(mocks.sendNotification).toHaveBeenNthCalledWith(2, {
      agencyId: fixture.agencyId,
      type: "CONTRACT_ACCEPTED",
      eventId: notificationEventId(
        "CONTRACT_ACCEPTED",
        fixture.contractId,
        "accepted-talent",
      ),
      title: "Contract started",
      message: `Your contract for “${CONTRACT_TITLE}” is now active.`,
      link,
      metadata: { contractId: fixture.contractId },
    });
  });

  it("answers 404 No agency workspace was found for the agency scope of a non-member before touching the contract", async () => {
    const fixture = await pending();
    const stranger = await insertAccount("FREELANCER");

    const response = await accept(fixture.contractId, stranger, "agency");

    expect(response.status).toBe(404);
    expect(response.body.message).toBe(
      "No agency workspace was found for this account.",
    );
    expect(mocks.emitConversationUpdate).not.toHaveBeenCalled();
    expect(mocks.sendNotification).not.toHaveBeenCalled();
    expect(JSON.parse(await rowState(fixture)).contract).toBe("PENDING");
  });

  it("propagates a rejected notification as a 500 and keeps the commit", async () => {
    const fixture = await pending();
    mocks.sendNotification.mockRejectedValue(new Error("broker down"));

    const response = await accept(fixture.contractId, fixture.ownerId);

    expect(response.status).toBe(500);
    expect(JSON.parse(await rowState(fixture)).contract).toBe("ACTIVE");
  });

  it("propagates a rejected emit as a 500 before any notification and keeps the commit", async () => {
    const fixture = await pending();
    mocks.emitConversationUpdate.mockRejectedValue(new Error("socket down"));

    const response = await accept(fixture.contractId, fixture.ownerId);

    expect(response.status).toBe(500);
    expect(mocks.sendNotification).not.toHaveBeenCalled();
    expect(JSON.parse(await rowState(fixture)).contract).toBe("ACTIVE");
  });
});

describe("submit milestone effects", () => {
  const active = (agency = false) =>
    seed({ agency, milestones: [{ status: "ACTIVE", funded: true }] });

  it("emits then notifies the client with the milestone ids, after the commit", async () => {
    const fixture = await active();
    const seen = watchCommit(fixture);

    const response = await submit(fixture, fixture.ownerId);

    expect(response.status).toBe(200);
    expect(response.body.message).toBe("Milestone submitted for review.");
    expect(response.body.data.milestoneId).toBe(fixture.milestoneIds[0]);
    expect(typeof response.body.data.paymentRequestedAt).toBe("string");
    expect(Object.keys(response.body.data).sort()).toEqual([
      "milestoneId",
      "paymentRequestedAt",
    ]);
    expect(mocks.emitConversationUpdate).toHaveBeenCalledTimes(1);
    expect(mocks.emitConversationUpdate).toHaveBeenCalledWith(
      fixture.conversationId,
      fixture.ownerId,
    );
    expect(mocks.sendNotification).not.toHaveBeenCalled();
    expect(mocks.push).toHaveBeenCalledTimes(1);
    expect(await storedNotices(fixture, "MILESTONE_SUBMITTED")).toEqual([
      {
        recipient_id: fixture.clientId,
        agency_id: null,
        type: "MILESTONE_SUBMITTED",
        title: "Milestone submitted for review",
        message: "Work was submitted for “Milestone 1”.",
        link: `/messages?conversationId=${fixture.conversationId}`,
        metadata: {
          contractId: fixture.contractId,
          milestoneId: fixture.milestoneIds[0],
        },
      },
    ]);
    expectEmitBeforeEveryNotification();
    expect(seen).toHaveLength(2);
    for (const entry of seen) expect(entry).toContain('"requested":true');
  });

  it("submits for the agency scope", async () => {
    const fixture = await active(true);

    const response = await submit(fixture, fixture.ownerId, {}, "agency");

    expect(response.status).toBe(200);
    expect(mocks.sendNotification).not.toHaveBeenCalled();
    expect(await storedNotices(fixture, "MILESTONE_SUBMITTED")).toEqual([
      expect.objectContaining({
        recipient_id: fixture.clientId,
        type: "MILESTONE_SUBMITTED",
      }),
    ]);
  });

  it("accepts an empty delivery link and an omitted one", async () => {
    const empty = await active();
    const first = await submit(empty, empty.ownerId, {
      submissionDeliveryLink: "",
    });
    expect(first.status).toBe(200);

    const omitted = await active();
    const request2 = await request(app)
      .patch(
        `${API}/${omitted.contractId}/milestones/${omitted.milestoneIds[0]}/submit`,
      )
      .query({ role: "freelancer" })
      .set(as(omitted.ownerId))
      .send({ submissionMessage: "The milestone work is complete." });
    expect(request2.status).toBe(200);
  });

  it.each(["not a url", "ftp://example.test/file", "javascript:alert(1)"])(
    "answers 400 Submission delivery link is invalid. for %s without effects",
    async (link) => {
      const fixture = await active();
      const before = await rowState(fixture);

      const response = await submit(fixture, fixture.ownerId, {
        submissionDeliveryLink: link,
      });

      expect(response.status).toBe(400);
      expect(response.body.message).toBe(
        "Submission delivery link is invalid.",
      );
      expect(mocks.emitConversationUpdate).not.toHaveBeenCalled();
      expect(mocks.sendNotification).not.toHaveBeenCalled();
      expect(await rowState(fixture)).toBe(before);
    },
  );

  it("accepts http and https links", async () => {
    for (const link of ["http://example.test/a", "https://example.test/a"]) {
      const fixture = await active();
      const response = await submit(fixture, fixture.ownerId, {
        submissionDeliveryLink: link,
      });
      expect(response.status).toBe(200);
    }
  });

  it("checks the agency scope before the link: 404 for a non-member with a bad link", async () => {
    const fixture = await active(true);
    const stranger = await insertAccount("FREELANCER");

    const response = await submit(
      fixture,
      stranger,
      { submissionDeliveryLink: "not a url" },
      "agency",
    );

    expect(response.status).toBe(404);
    expect(response.body.message).toBe(
      "No agency workspace was found for this account.",
    );
    expect(mocks.sendNotification).not.toHaveBeenCalled();
  });

  it("checks the link before the contract: 400 for a bad link on an unknown contract", async () => {
    const fixture = await active();
    const response = await request(app)
      .patch(`${API}/${randomUUID()}/milestones/${randomUUID()}/submit`)
      .query({ role: "freelancer" })
      .set(as(fixture.ownerId))
      .send({
        submissionMessage: "The milestone work is complete.",
        submissionDeliveryLink: "not a url",
      });

    expect(response.status).toBe(400);
    expect(response.body.message).toBe("Submission delivery link is invalid.");
  });

  it("is not affected by a rejected broker publish and keeps the commit", async () => {
    const fixture = await active();
    mocks.sendNotification.mockRejectedValue(new Error("broker down"));

    const response = await submit(fixture, fixture.ownerId);

    expect(response.status).toBe(200);
    expect(mocks.sendNotification).not.toHaveBeenCalled();
    expect(await storedNotices(fixture, "MILESTONE_SUBMITTED")).toHaveLength(1);
    expect(JSON.parse(await rowState(fixture)).milestones[0].requested).toBe(
      true,
    );
  });

  it("propagates a rejected emit as a 500 before any notification", async () => {
    const fixture = await active();
    mocks.emitConversationUpdate.mockRejectedValue(new Error("socket down"));

    const response = await submit(fixture, fixture.ownerId);

    expect(response.status).toBe(500);
    expect(mocks.sendNotification).not.toHaveBeenCalled();
  });
});

describe("review milestone effects", () => {
  const underReview = (agency = false) =>
    seed({
      agency,
      milestones: [{ status: "ACTIVE", funded: true, requested: true }],
    });

  const stored = (
    fixture: Fixture,
    type: string,
    title: string,
    message: string,
  ) => ({
    recipient_id: fixture.agencyId ? null : fixture.ownerId,
    agency_id: fixture.agencyId,
    type,
    title,
    message,
    link: `/messages?conversationId=${fixture.conversationId}`,
    metadata: {
      contractId: fixture.contractId,
      milestoneId: fixture.milestoneIds[0],
    },
  });

  it.each([false, true])(
    "approves, emits then notifies the talent (agency: %s) after the commit",
    async (agency) => {
      const fixture = await underReview(agency);
      const seen = watchCommit(fixture);

      const response = await review(fixture, "APPROVE");

      expect(response.status).toBe(200);
      expect(response.body).toEqual({
        success: true,
        message: "Milestone work accepted.",
        data: { milestoneId: fixture.milestoneIds[0] },
      });
      expect(mocks.emitConversationUpdate).toHaveBeenCalledTimes(1);
      expect(mocks.emitConversationUpdate).toHaveBeenCalledWith(
        fixture.conversationId,
        fixture.clientId,
      );
      expect(mocks.sendNotification).not.toHaveBeenCalled();
      expect(mocks.push).toHaveBeenCalledTimes(1);
      expect(await storedNotices(fixture, "MILESTONE_APPROVED")).toEqual([
        stored(
          fixture,
          "MILESTONE_APPROVED",
          "Milestone accepted",
          "Your work for “Milestone 1” was accepted.",
        ),
      ]);
      expectEmitBeforeEveryNotification();
      for (const entry of seen) {
        expect(entry).toContain('"status":"COMPLETED"');
      }
      expect(seen).toHaveLength(2);
    },
  );

  it.each([false, true])(
    "requests changes and notifies the talent (agency: %s)",
    async (agency) => {
      const fixture = await underReview(agency);

      const response = await review(
        fixture,
        "REQUEST_CHANGES",
        "Please adjust the layout.",
      );

      expect(response.status).toBe(200);
      expect(response.body).toEqual({
        success: true,
        message: "Modifications requested.",
        data: { milestoneId: fixture.milestoneIds[0] },
      });
      expect(mocks.sendNotification).not.toHaveBeenCalled();
      expect(
        await storedNotices(fixture, "MILESTONE_CHANGES_REQUESTED"),
      ).toEqual([
        stored(
          fixture,
          "MILESTONE_CHANGES_REQUESTED",
          "Modifications requested",
          "The client requested modifications for “Milestone 1”.",
        ),
      ]);
      expectEmitBeforeEveryNotification();
    },
  );

  it("answers 400 Modification message is required. without effects", async () => {
    const fixture = await underReview();
    const before = await rowState(fixture);

    const response = await review(fixture, "REQUEST_CHANGES");

    expect(response.status).toBe(400);
    expect(response.body.message).toBe("Modification message is required.");
    expect(mocks.emitConversationUpdate).not.toHaveBeenCalled();
    expect(mocks.sendNotification).not.toHaveBeenCalled();
    expect(await rowState(fixture)).toBe(before);
  });

  it("is not affected by a rejected broker publish and keeps the commit", async () => {
    const fixture = await underReview();
    mocks.sendNotification.mockRejectedValue(new Error("broker down"));

    const response = await review(fixture, "APPROVE");

    expect(response.status).toBe(200);
    expect(mocks.sendNotification).not.toHaveBeenCalled();
    expect(await storedNotices(fixture, "MILESTONE_APPROVED")).toHaveLength(1);
    expect(JSON.parse(await rowState(fixture)).milestones[0].status).toBe(
      "COMPLETED",
    );
  });
});

describe("add milestone date check", () => {
  it("answers 400 for a due date before today without effects", async () => {
    const fixture = await seed({
      milestones: [{ status: "COMPLETED", funded: true }],
    });
    const before = await rowState(fixture);

    const response = await addMilestone(
      fixture.contractId,
      fixture.clientId,
      "2000-01-01",
    );

    expect(response.status).toBe(400);
    expect(response.body.message).toBe(
      "Milestone due date cannot be earlier than today.",
    );
    expect(mocks.sendNotification).not.toHaveBeenCalled();
    expect(await rowState(fixture)).toBe(before);
  });

  it("checks the date before the contract: 400 for a past date on an unknown contract", async () => {
    const fixture = await seed();

    const response = await addMilestone(
      randomUUID(),
      fixture.clientId,
      "2000-01-01",
    );

    expect(response.status).toBe(400);
  });

  it("accepts today", async () => {
    const fixture = await seed({
      milestones: [{ status: "COMPLETED", funded: true }],
    });
    const now = new Date();
    const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;

    const response = await addMilestone(
      fixture.contractId,
      fixture.clientId,
      today,
    );

    expect(response.status).toBe(201);
  });
});

describe("finish contract effects", () => {
  const completed = (agency = false) =>
    seed({ agency, milestones: [{ status: "COMPLETED", funded: true }] });

  it("completes: emits then notifies the freelancer, after the commit", async () => {
    const fixture = await completed();
    const seen = watchCommit(fixture);

    const response = await finish(
      fixture.contractId,
      fixture.clientId,
      "client",
    );

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      success: true,
      message: "Contract completed and review submitted.",
      data: { contractId: fixture.contractId, status: "COMPLETED" },
    });
    expect(mocks.emitConversationUpdate).toHaveBeenCalledTimes(1);
    expect(mocks.emitConversationUpdate).toHaveBeenCalledWith(
      fixture.conversationId,
      fixture.clientId,
    );
    expect(mocks.sendNotification).toHaveBeenCalledTimes(1);
    expect(mocks.sendNotification).toHaveBeenCalledWith({
      recipientId: fixture.ownerId,
      type: "CONTRACT_COMPLETED",
      eventId: notificationEventId(
        "CONTRACT_COMPLETED",
        fixture.contractId,
        "completed",
      ),
      title: "Contract completed",
      message: `The contract “${CONTRACT_TITLE}” was completed.`,
      link: `/contracts?contractId=${fixture.contractId}`,
      metadata: { contractId: fixture.contractId },
    });
    expectEmitBeforeEveryNotification();
    expect(seen).toHaveLength(2);
    for (const entry of seen) expect(entry).toContain('"contract":"COMPLETED"');
  });

  it("notifies the agency when the contract belongs to one", async () => {
    const fixture = await completed(true);

    const response = await finish(
      fixture.contractId,
      fixture.clientId,
      "client",
    );

    expect(response.status).toBe(200);
    expect(mocks.sendNotification).toHaveBeenCalledTimes(1);
    expect(mocks.sendNotification).toHaveBeenCalledWith({
      agencyId: fixture.agencyId,
      type: "CONTRACT_COMPLETED",
      eventId: notificationEventId(
        "CONTRACT_COMPLETED",
        fixture.contractId,
        "completed",
      ),
      title: "Contract completed",
      message: `The contract “${CONTRACT_TITLE}” was completed.`,
      link: `/contracts?contractId=${fixture.contractId}`,
      metadata: { contractId: fixture.contractId },
    });
  });

  it("a second party's review sends REVIEW_RECEIVED without an emit", async () => {
    const fixture = await completed();
    await finish(fixture.contractId, fixture.clientId, "client");
    mocks.sendNotification.mockClear();
    mocks.emitConversationUpdate.mockClear();

    const response = await finish(
      fixture.contractId,
      fixture.ownerId,
      "freelancer",
    );

    expect(response.status).toBe(200);
    expect(response.body.message).toBe("Review submitted.");
    expect(mocks.emitConversationUpdate).not.toHaveBeenCalled();
    expect(mocks.sendNotification).toHaveBeenCalledTimes(1);
    expect(mocks.sendNotification).toHaveBeenCalledWith({
      recipientId: fixture.clientId,
      type: "REVIEW_RECEIVED",
      eventId: notificationEventId(
        "REVIEW_RECEIVED",
        fixture.contractId,
        "review-freelancer",
      ),
      title: "New review received",
      message: `You received a review for “${CONTRACT_TITLE}”.`,
      link: `/contracts?contractId=${fixture.contractId}`,
      metadata: { contractId: fixture.contractId },
    });
  });

  it("answers 404 for the agency scope of a non-member without effects", async () => {
    const fixture = await completed(true);
    const stranger = await insertAccount("FREELANCER");

    const response = await request(app)
      .post(`${API}/${fixture.contractId}/finish`)
      .query({ role: "freelancer", scope: "agency" })
      .set(as(stranger))
      .send({ rating: 5, comment: "Great collaboration, would hire again." });

    expect(response.status).toBe(404);
    expect(response.body.message).toBe(
      "No agency workspace was found for this account.",
    );
    expect(mocks.emitConversationUpdate).not.toHaveBeenCalled();
    expect(mocks.sendNotification).not.toHaveBeenCalled();
  });

  it("propagates a rejected notification as a 500 and keeps the commit", async () => {
    const fixture = await completed();
    mocks.sendNotification.mockRejectedValue(new Error("broker down"));

    const response = await finish(
      fixture.contractId,
      fixture.clientId,
      "client",
    );

    expect(response.status).toBe(500);
    expect(JSON.parse(await rowState(fixture)).contract).toBe("COMPLETED");
  });
});
