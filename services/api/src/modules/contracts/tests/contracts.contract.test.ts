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
  emitConversationUpdate: vi.fn(),
  customersCreate: vi.fn(),
  sessionsCreate: vi.fn(),
}));

vi.mock("../../../config/env.js", async (importOriginal) => {
  const original =
    await importOriginal<typeof import("../../../config/env.js")>();
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

vi.mock("../../../infrastructure/clerk.js", () => ({
  clerk: { users: { getUser: mocks.getUser } },
  verifyToken: mocks.verifyToken,
}));

vi.mock("../../../infrastructure/stripe.js", () => ({
  STRIPE_TIMEOUT_MS: 30_000,
  stripe: {
    customers: { create: mocks.customersCreate },
    checkout: { sessions: { create: mocks.sessionsCreate } },
  },
}));

vi.mock("../../../infrastructure/image-kit.js", () => ({
  imageKit: { files: { upload: vi.fn(), delete: vi.fn() } },
}));

vi.mock("../../../infrastructure/redis.js", () => ({
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
  "../../../infrastructure/events/publisher.js",
  async (importOriginal) => ({
    ...(await importOriginal<
      typeof import("../../../infrastructure/events/publisher.js")
    >()),
    sendNotification: mocks.sendNotification,
  }),
);

vi.mock("../../messaging/messaging.socket.js", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("../../messaging/messaging.socket.js")
  >()),
  emitConversationUpdate: mocks.emitConversationUpdate,
}));

import { db, pool } from "../../../database/client.js";
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
} from "../../../database/schema.js";
import { assertTestDatabase } from "../../../test/setup/assert-test-database.js";
import { contractsResponses } from "../contracts.responses.js";

const { app } = await import("../../../app.js");

const PREFIX = "contracts-contract-it-";
const API = "/api/v1/contracts";
const AMOUNT = 20000;

const as = (userId: string) => ({ Authorization: `Bearer ${userId}` });
const newAuthId = () => `${PREFIX}${randomUUID()}`;
const missingId = () => randomUUID();

const futureDate = () => {
  const date = new Date();
  date.setDate(date.getDate() + 14);
  return date.toISOString().slice(0, 10);
};

const insertAccount = async (
  role: "CLIENT" | "FREELANCER",
  options: { identityVerified?: boolean; customer?: boolean } = {},
) => {
  const authId = newAuthId();
  await db.insert(accounts).values({
    auth_id: authId,
    email: `${authId}@example.test`,
    role,
    identityVerified: options.identityVerified ?? true,
    stripe_customer_id: options.customer ? `cus_${randomUUID()}` : null,
    created_at: new Date(),
    updated_at: new Date(),
  });
  return authId;
};

type MilestoneSeed = {
  status: "PENDING" | "ACTIVE" | "COMPLETED";
  funded?: boolean;
  requested?: boolean;
};

const seed = async (
  options: {
    contractStatus?: "PENDING" | "ACTIVE" | "COMPLETED";
    milestones?: MilestoneSeed[];
    proposalStatus?: string;
    agency?: boolean;
    unverified?: boolean;
  } = {},
) => {
  const seeds = options.milestones ?? [
    { status: "ACTIVE", funded: true, requested: true },
  ];
  const clientId = await insertAccount("CLIENT", { customer: true });
  const ownerId = await insertAccount("FREELANCER", {
    identityVerified: !options.unverified,
  });
  let agencyId: string | null = null;
  if (options.agency) {
    const [agency] = await db
      .insert(agency_metadata)
      .values({
        owner_id: ownerId,
        name: `${PREFIX}agency-${randomUUID()}`,
        size: "1-10",
        specialty: "testing",
        overview: "contract test agency",
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
      status: options.proposalStatus ?? "SUBMITTED",
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
      title: "Contract title",
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
    proposalId: proposal!.id,
    contractId: contract!.id,
    milestoneIds: milestoneRows.map((row) => row.id),
  };
};

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
  await pool.query("delete from accounts where auth_id like $1", [like]);
};

type Fixture = Awaited<ReturnType<typeof seed>>;

const snapshot = async (fixture: Fixture) => {
  const rows = async (text: string, params: unknown[]) =>
    (await pool.query(text, params)).rows;
  return JSON.stringify({
    contract: await rows("select * from contracts where id = $1", [
      fixture.contractId,
    ]),
    milestones: await rows(
      "select * from contract_milestones where contract_id = $1 order by position",
      [fixture.contractId],
    ),
    reviews: await rows("select * from reviews where contract_id = $1", [
      fixture.contractId,
    ]),
    earningHistory: await rows(
      "select * from earning_history where contract_id = $1",
      [fixture.contractId],
    ),
    freelancerEarning: await rows(
      "select * from freelancer_earning where freelancer_id = $1",
      [fixture.ownerId],
    ),
    clientSpents: await rows(
      "select * from client_spents where client_id = $1",
      [fixture.clientId],
    ),
    messages: await rows(
      "select m.* from messages m join conversations c on c.id = m.conversation_id where c.proposal_id = $1 order by m.created_at, m.id",
      [fixture.proposalId],
    ),
    participants: await rows(
      "select p.* from conversation_participants p join conversations c on c.id = p.conversation_id where c.proposal_id = $1 order by p.id",
      [fixture.proposalId],
    ),
    job: await rows(
      "select * from job_posts where id = (select job_id from contracts where id = $1)",
      [fixture.contractId],
    ),
  });
};

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
  mocks.emitConversationUpdate.mockReset();
  mocks.customersCreate.mockReset();
  mocks.sessionsCreate.mockReset();
  mocks.getUser.mockResolvedValue({
    firstName: "Test",
    lastName: "User",
    imageUrl: "https://example.test/avatar.png",
  });
  mocks.verifyToken.mockImplementation(async (token: string) => ({
    sub: token,
    sid: `sess_${token}`,
  }));
  mocks.customersCreate.mockImplementation(async () => ({
    id: `cus_${randomUUID()}`,
  }));
  mocks.sessionsCreate.mockResolvedValue({ url: "https://stripe.test/pay" });
  mocks.sendNotification.mockResolvedValue(undefined);
});

describe("GET /contracts/client", () => {
  it("matches the 200 schema", async () => {
    const fixture = await seed({
      milestones: [
        { status: "COMPLETED", funded: true },
        { status: "ACTIVE", funded: true, requested: true },
        { status: "PENDING" },
      ],
    });
    const response = await request(app)
      .get(`${API}/client`)
      .query({ role: "client" })
      .set(as(fixture.clientId));
    expect(response.status).toBe(200);
    const body = contractsResponses.client[200].parse(response.body);
    expect(body.data).toHaveLength(1);
    expect(body.data[0]?.milestones).toHaveLength(3);
  });

  it("matches the 200 schema for an agency counterparty", async () => {
    const fixture = await seed({ agency: true });
    const response = await request(app)
      .get(`${API}/client`)
      .query({ role: "client" })
      .set(as(fixture.clientId));
    expect(response.status).toBe(200);
    const body = contractsResponses.client[200].parse(response.body);
    expect(body.data).toHaveLength(1);
  });

  it("matches the 403 schema for a freelancer account", async () => {
    const fixture = await seed();
    const response = await request(app)
      .get(`${API}/client`)
      .query({ role: "freelancer" })
      .set(as(fixture.ownerId));
    expect(response.status).toBe(403);
    contractsResponses.client[403].parse(response.body);
  });
});

describe("contract listing order and scope", () => {
  const listContracts = async (
    path: "client" | "freelancer",
    userId: string,
    query: Record<string, string>,
  ) => {
    const response = await request(app)
      .get(`${API}/${path}`)
      .query(query)
      .set(as(userId));
    expect(response.status).toBe(200);
    return response.body.data as {
      id: string;
      milestones: { id: string; position: number }[];
    }[];
  };

  it("lists milestones by position even when their rows were written out of order", async () => {
    const fixture = await seed({
      milestones: [
        { status: "COMPLETED", funded: true },
        { status: "ACTIVE", funded: true },
        { status: "PENDING" },
      ],
    });
    await pool.query(
      "with moved as (delete from contract_milestones where contract_id = $1 returning *) insert into contract_milestones select * from moved order by position desc",
      [fixture.contractId],
    );
    const data = await listContracts("client", fixture.clientId, {
      role: "client",
    });
    expect(data.map((contract) => contract.id)).toEqual([fixture.contractId]);
    expect(data[0]?.milestones.map((milestone) => milestone.position)).toEqual([
      0, 1, 2,
    ]);
    expect(data[0]?.milestones.map((milestone) => milestone.id)).toEqual(
      fixture.milestoneIds,
    );
  });

  it("lists a client's contracts newest first", async () => {
    const fixture = await seed();
    const [job] = await db
      .insert(job_posts)
      .values({
        client_id: fixture.clientId,
        title: "Second contract job",
        description: "Second contract test job",
        expertise_level: "INTERMEDIATE",
        expected_duration: "1 week",
        total_budget_cents: AMOUNT,
        milestones: [],
      })
      .returning({ id: job_posts.id });
    const [proposal] = await db
      .insert(proposals)
      .values({
        job_id: job!.id,
        sender_id: fixture.ownerId,
        sender_type: "FREELANCER",
        cover_letter: "second contract",
        bid_amount_cents: AMOUNT,
        duration: "1 week",
      })
      .returning({ id: proposals.id });
    const [second] = await db
      .insert(contracts)
      .values({
        proposal_id: proposal!.id,
        job_id: job!.id,
        client_id: fixture.clientId,
        freelancer_id: fixture.ownerId,
        title: "Second contract title",
        total_amount_cents: AMOUNT,
        status: "ACTIVE",
        started_at: new Date(),
        created_at: new Date(Date.now() + 60_000),
      })
      .returning({ id: contracts.id });
    await db.insert(contract_milestones).values({
      contract_id: second!.id,
      title: "Only milestone",
      amount_cents: AMOUNT,
      due_date: "2026-12-01",
      position: 0,
      status: "ACTIVE",
      funded_at: new Date(),
    });
    const data = await listContracts("client", fixture.clientId, {
      role: "client",
    });
    expect(data.map((contract) => contract.id)).toEqual([
      second!.id,
      fixture.contractId,
    ]);
  });

  it("scopes each listing to the caller's own contracts", async () => {
    const first = await seed();
    await seed();
    expect(
      (await listContracts("client", first.clientId, { role: "client" })).map(
        (contract) => contract.id,
      ),
    ).toEqual([first.contractId]);
    expect(
      (
        await listContracts("freelancer", first.ownerId, {
          role: "freelancer",
        })
      ).map((contract) => contract.id),
    ).toEqual([first.contractId]);

    const firstAgency = await seed({ agency: true });
    const secondAgency = await seed({ agency: true });
    for (const agency of [firstAgency, secondAgency]) {
      expect(
        (
          await listContracts("freelancer", agency.ownerId, {
            role: "freelancer",
            scope: "agency",
          })
        ).map((contract) => contract.id),
      ).toEqual([agency.contractId]);
    }
  });
});

describe("GET /contracts/freelancer", () => {
  it("matches the 200 schema", async () => {
    const fixture = await seed();
    const response = await request(app)
      .get(`${API}/freelancer`)
      .query({ role: "freelancer" })
      .set(as(fixture.ownerId));
    expect(response.status).toBe(200);
    const body = contractsResponses.freelancer[200].parse(response.body);
    expect(body.data).toHaveLength(1);
  });

  it("matches the 200 schema for the agency scope", async () => {
    const fixture = await seed({ agency: true });
    const response = await request(app)
      .get(`${API}/freelancer`)
      .query({ role: "freelancer", scope: "agency" })
      .set(as(fixture.ownerId));
    expect(response.status).toBe(200);
    const body = contractsResponses.freelancer[200].parse(response.body);
    expect(body.data).toHaveLength(1);
  });

  it("matches the 403 schema for a client account", async () => {
    const fixture = await seed();
    const response = await request(app)
      .get(`${API}/freelancer`)
      .query({ role: "client" })
      .set(as(fixture.clientId));
    expect(response.status).toBe(403);
    contractsResponses.freelancer[403].parse(response.body);
  });
});

describe("PATCH /contracts/:contractId/accept", () => {
  const accept = (contractId: string, userId: string) =>
    request(app)
      .patch(`${API}/${contractId}/accept`)
      .query({ role: "freelancer" })
      .set(as(userId))
      .send({});

  it("matches the 200 and 409 schemas", async () => {
    const fixture = await seed({
      contractStatus: "PENDING",
      milestones: [{ status: "PENDING", funded: true }],
    });
    const response = await accept(fixture.contractId, fixture.ownerId);
    expect(response.status).toBe(200);
    contractsResponses.accept[200].parse(response.body);

    const again = await accept(fixture.contractId, fixture.ownerId);
    expect(again.status).toBe(409);
    contractsResponses.accept[409].parse(again.body);
  });

  it("matches the 403 schema without identity verification", async () => {
    const fixture = await seed({
      contractStatus: "PENDING",
      milestones: [{ status: "PENDING", funded: true }],
      unverified: true,
    });
    const response = await accept(fixture.contractId, fixture.ownerId);
    expect(response.status).toBe(403);
    contractsResponses.accept[403].parse(response.body);
  });

  it("matches the 404 schema", async () => {
    const fixture = await seed();
    const response = await accept(missingId(), fixture.ownerId);
    expect(response.status).toBe(404);
    contractsResponses.accept[404].parse(response.body);
  });
});

describe("PATCH /contracts/:contractId/milestones/:milestoneId/submit", () => {
  const submit = (contractId: string, milestoneId: string, userId: string) =>
    request(app)
      .patch(`${API}/${contractId}/milestones/${milestoneId}/submit`)
      .query({ role: "freelancer" })
      .set(as(userId))
      .send({
        submissionMessage: "The milestone work is complete.",
        submissionDeliveryLink: "https://example.test/delivery",
      });

  it("matches the 200 schema", async () => {
    const fixture = await seed({
      milestones: [{ status: "ACTIVE", funded: true }],
    });
    const response = await submit(
      fixture.contractId,
      fixture.milestoneIds[0]!,
      fixture.ownerId,
    );
    expect(response.status).toBe(200);
    contractsResponses.submit[200].parse(response.body);
  });

  it("matches the 409 schema", async () => {
    const fixture = await seed({
      contractStatus: "PENDING",
      milestones: [{ status: "PENDING", funded: true }],
    });
    const response = await submit(
      fixture.contractId,
      fixture.milestoneIds[0]!,
      fixture.ownerId,
    );
    expect(response.status).toBe(409);
    contractsResponses.submit[409].parse(response.body);
  });

  it("matches the 403 and 404 schemas", async () => {
    const fixture = await seed();
    const forbidden = await request(app)
      .patch(
        `${API}/${fixture.contractId}/milestones/${fixture.milestoneIds[0]}/submit`,
      )
      .query({ role: "client" })
      .set(as(fixture.clientId))
      .send({ submissionMessage: "The milestone work is complete." });
    expect(forbidden.status).toBe(403);
    contractsResponses.submit[403].parse(forbidden.body);

    const missing = await submit(
      fixture.contractId,
      missingId(),
      fixture.ownerId,
    );
    expect(missing.status).toBe(404);
    contractsResponses.submit[404].parse(missing.body);
  });
});

describe("PATCH /contracts/:contractId/milestones/:milestoneId/review", () => {
  const review = (
    contractId: string,
    milestoneId: string,
    userId: string,
    action: "APPROVE" | "REQUEST_CHANGES" = "APPROVE",
  ) =>
    request(app)
      .patch(`${API}/${contractId}/milestones/${milestoneId}/review`)
      .query({ role: "client" })
      .set(as(userId))
      .send({ action, feedback: "Please adjust the layout." });

  it("matches the 200 schema when approving and then the 409 schema", async () => {
    const fixture = await seed();
    const response = await review(
      fixture.contractId,
      fixture.milestoneIds[0]!,
      fixture.clientId,
    );
    expect(response.status).toBe(200);
    contractsResponses.review[200].parse(response.body);

    const again = await review(
      fixture.contractId,
      fixture.milestoneIds[0]!,
      fixture.clientId,
    );
    expect(again.status).toBe(409);
    contractsResponses.review[409].parse(again.body);
  });

  it("matches the 200 schema when requesting changes", async () => {
    const fixture = await seed();
    const response = await review(
      fixture.contractId,
      fixture.milestoneIds[0]!,
      fixture.clientId,
      "REQUEST_CHANGES",
    );
    expect(response.status).toBe(200);
    contractsResponses.review[200].parse(response.body);
  });

  it("matches the 403 and 404 schemas", async () => {
    const fixture = await seed();
    const forbidden = await request(app)
      .patch(
        `${API}/${fixture.contractId}/milestones/${fixture.milestoneIds[0]}/review`,
      )
      .query({ role: "freelancer" })
      .set(as(fixture.ownerId))
      .send({ action: "APPROVE" });
    expect(forbidden.status).toBe(403);
    contractsResponses.review[403].parse(forbidden.body);

    const missing = await review(
      fixture.contractId,
      missingId(),
      fixture.clientId,
    );
    expect(missing.status).toBe(404);
    contractsResponses.review[404].parse(missing.body);
  });
});

describe("POST /contracts/checkout", () => {
  const checkout = (proposalId: string, userId: string, role = "client") =>
    request(app)
      .post(`${API}/checkout`)
      .query({ role })
      .set(as(userId))
      .send({ proposalId });

  it("matches the 200 schema", async () => {
    const fixture = await seed({ proposalStatus: "INTERVIEWED" });
    const response = await checkout(fixture.proposalId, fixture.clientId);
    expect(response.status).toBe(200);
    contractsResponses.checkout[200].parse(response.body);
  });

  it("matches the 403 and 404 schemas", async () => {
    const fixture = await seed({ proposalStatus: "INTERVIEWED" });
    const forbidden = await checkout(
      fixture.proposalId,
      fixture.ownerId,
      "freelancer",
    );
    expect(forbidden.status).toBe(403);
    contractsResponses.checkout[403].parse(forbidden.body);

    const missing = await checkout(missingId(), fixture.clientId);
    expect(missing.status).toBe(404);
    contractsResponses.checkout[404].parse(missing.body);
  });
});

describe("POST /contracts/:contractId/milestones/:milestoneId/checkout", () => {
  const checkout = (
    contractId: string,
    milestoneId: string,
    userId: string,
    role = "client",
  ) =>
    request(app)
      .post(`${API}/${contractId}/milestones/${milestoneId}/checkout`)
      .query({ role })
      .set(as(userId))
      .send({ requirements: "Use the brand colours." });

  it("matches the 200 schema", async () => {
    const fixture = await seed({
      milestones: [
        { status: "COMPLETED", funded: true },
        { status: "PENDING" },
      ],
    });
    const response = await checkout(
      fixture.contractId,
      fixture.milestoneIds[1]!,
      fixture.clientId,
    );
    expect(response.status).toBe(200);
    contractsResponses.milestoneCheckout[200].parse(response.body);
  });

  it("matches the 409 schema", async () => {
    const fixture = await seed();
    const response = await checkout(
      fixture.contractId,
      fixture.milestoneIds[0]!,
      fixture.clientId,
    );
    expect(response.status).toBe(409);
    contractsResponses.milestoneCheckout[409].parse(response.body);
  });

  it("matches the 403 and 404 schemas", async () => {
    const fixture = await seed();
    const forbidden = await checkout(
      fixture.contractId,
      fixture.milestoneIds[0]!,
      fixture.ownerId,
      "freelancer",
    );
    expect(forbidden.status).toBe(403);
    contractsResponses.milestoneCheckout[403].parse(forbidden.body);

    const missing = await checkout(
      fixture.contractId,
      missingId(),
      fixture.clientId,
    );
    expect(missing.status).toBe(404);
    contractsResponses.milestoneCheckout[404].parse(missing.body);
  });

  it("answers 404 to a client who does not own the contract and changes nothing", async () => {
    const fixture = await seed({
      milestones: [
        { status: "COMPLETED", funded: true },
        { status: "PENDING" },
      ],
    });
    const intruder = await insertAccount("CLIENT", { customer: true });
    const before = await snapshot(fixture);

    const denied = await checkout(
      fixture.contractId,
      fixture.milestoneIds[1]!,
      intruder,
    );
    expect(denied.status).toBe(404);
    expect(denied.body).toEqual({
      success: false,
      message: "Contract milestone not found.",
    });
    expect(mocks.customersCreate).not.toHaveBeenCalled();
    expect(mocks.sessionsCreate).not.toHaveBeenCalled();
    expect(await snapshot(fixture)).toBe(before);

    const owner = await checkout(
      fixture.contractId,
      fixture.milestoneIds[1]!,
      fixture.clientId,
    );
    expect(owner.status).toBe(200);
    expect(mocks.sessionsCreate).toHaveBeenCalledTimes(1);
  });
});

describe("POST /contracts/:contractId/milestones", () => {
  const add = (contractId: string, userId: string, role = "client") =>
    request(app)
      .post(`${API}/${contractId}/milestones`)
      .query({ role })
      .set(as(userId))
      .send({
        title: "Extra milestone",
        amountCents: 15000,
        dueDate: futureDate(),
      });

  it("matches the 201 schema and then the 409 schema", async () => {
    const fixture = await seed({
      milestones: [{ status: "COMPLETED", funded: true }],
    });
    const response = await add(fixture.contractId, fixture.clientId);
    expect(response.status).toBe(201);
    contractsResponses.addMilestone[201].parse(response.body);

    const again = await add(fixture.contractId, fixture.clientId);
    expect(again.status).toBe(409);
    contractsResponses.addMilestone[409].parse(again.body);
  });

  it("matches the 403 and 404 schemas", async () => {
    const fixture = await seed();
    const forbidden = await add(
      fixture.contractId,
      fixture.ownerId,
      "freelancer",
    );
    expect(forbidden.status).toBe(403);
    contractsResponses.addMilestone[403].parse(forbidden.body);

    const missing = await add(missingId(), fixture.clientId);
    expect(missing.status).toBe(404);
    contractsResponses.addMilestone[404].parse(missing.body);
  });

  it("answers 404 to a client who does not own the contract and changes nothing", async () => {
    const fixture = await seed({
      milestones: [{ status: "COMPLETED", funded: true }],
    });
    const intruder = await insertAccount("CLIENT");
    const before = await snapshot(fixture);

    const denied = await add(fixture.contractId, intruder);
    expect(denied.status).toBe(404);
    expect(denied.body).toEqual({
      success: false,
      message: "Contract not found.",
    });
    expect(mocks.sendNotification).not.toHaveBeenCalled();
    expect(await snapshot(fixture)).toBe(before);

    const owner = await add(fixture.contractId, fixture.clientId);
    expect(owner.status).toBe(201);
  });
});

describe("POST /contracts/:contractId/finish", () => {
  const finish = (
    contractId: string,
    userId: string,
    role: "client" | "freelancer" = "client",
  ) =>
    request(app)
      .post(`${API}/${contractId}/finish`)
      .query({ role })
      .set(as(userId))
      .send({ rating: 5, comment: "Great collaboration, would hire again." });

  it("matches the 200 schema and then the 409 schema", async () => {
    const fixture = await seed({
      milestones: [{ status: "COMPLETED", funded: true }],
    });
    const response = await finish(fixture.contractId, fixture.clientId);
    expect(response.status).toBe(200);
    contractsResponses.finish[200].parse(response.body);

    const again = await finish(fixture.contractId, fixture.clientId);
    expect(again.status).toBe(409);
    contractsResponses.finish[409].parse(again.body);
  });

  it("matches the 409 schema for incomplete milestones", async () => {
    const fixture = await seed();
    const response = await finish(fixture.contractId, fixture.clientId);
    expect(response.status).toBe(409);
    contractsResponses.finish[409].parse(response.body);
  });

  it("matches the 403 schema for a freelancer outside the agency", async () => {
    const fixture = await seed({
      agency: true,
      milestones: [{ status: "COMPLETED", funded: true }],
    });
    const member = await insertAccount("FREELANCER");
    const response = await request(app)
      .post(`${API}/${fixture.contractId}/finish`)
      .query({ role: "freelancer", scope: "agency" })
      .set(as(member))
      .send({ rating: 5, comment: "Great collaboration, would hire again." });
    expect(response.status).toBe(403);
    contractsResponses.finish[403].parse(response.body);
  });

  it("matches the 404 schema", async () => {
    const fixture = await seed();
    const response = await finish(missingId(), fixture.clientId);
    expect(response.status).toBe(404);
    contractsResponses.finish[404].parse(response.body);
  });

  it("answers 404 to a client who does not own the contract and changes nothing", async () => {
    const fixture = await seed({
      milestones: [{ status: "COMPLETED", funded: true }],
    });
    const intruder = await insertAccount("CLIENT");
    const before = await snapshot(fixture);

    const denied = await finish(fixture.contractId, intruder);
    expect(denied.status).toBe(404);
    expect(denied.body).toEqual({
      success: false,
      message: "Contract not found.",
    });
    expect(mocks.sendNotification).not.toHaveBeenCalled();
    expect(await snapshot(fixture)).toBe(before);

    const owner = await finish(fixture.contractId, fixture.clientId);
    expect(owner.status).toBe(200);
  });
});
