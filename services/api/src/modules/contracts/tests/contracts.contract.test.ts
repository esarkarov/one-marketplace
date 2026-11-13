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
  client_metadata,
  contract_milestones,
  contracts,
  conversation_participants,
  conversations,
  job_posts,
  proposals,
  reviews,
} from "../../../test/support/tables.js";
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
  await pool.query("delete from client_metadata where auth_id like $1", [like]);
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

describe("contract listing counterparty and review flags", () => {
  type ListedContract = {
    id: string;
    counterpartyName: string;
    reviewedByCurrentUser: boolean;
    milestones: { id: string }[];
  };

  const listFor = async (
    path: "client" | "freelancer",
    userId: string,
    query: Record<string, string>,
  ) => {
    const response = await request(app)
      .get(`${API}/${path}`)
      .query(query)
      .set(as(userId));
    expect(response.status).toBe(200);
    return response.body.data as ListedContract[];
  };
  const asClient = (userId: string) =>
    listFor("client", userId, { role: "client" });
  const asFreelancer = (userId: string) =>
    listFor("freelancer", userId, { role: "freelancer" });
  const asAgency = (userId: string) =>
    listFor("freelancer", userId, { role: "freelancer", scope: "agency" });
  const flagOf = (data: ListedContract[], contractId: string) =>
    data.find((contract) => contract.id === contractId)?.reviewedByCurrentUser;

  const insertCompany = (clientId: string, companyName: string) =>
    db.insert(client_metadata).values({
      auth_id: clientId,
      role: "Founder",
      company_name: companyName,
      company_website: "https://company.example.test",
      company_size: "11-50",
      industry: "Software",
      company_description: "contract test company",
    });

  const addReview = (
    contractId: string,
    reviewerId: string,
    revieweeId: string,
    agencyId: string | null = null,
  ) =>
    db.insert(reviews).values({
      contract_id: contractId,
      reviewer_id: reviewerId,
      reviewee_id: revieweeId,
      agency_id: agencyId,
      rating: 5,
      comment: "Great work",
    });

  const addSecondContract = async (fixture: Fixture) => {
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
        sender_id: fixture.agencyId ?? fixture.ownerId,
        sender_type: fixture.agencyId ? "AGENCY" : "FREELANCER",
        cover_letter: "second contract",
        bid_amount_cents: AMOUNT,
        duration: "1 week",
      })
      .returning({ id: proposals.id });
    const [contract] = await db
      .insert(contracts)
      .values({
        proposal_id: proposal!.id,
        job_id: job!.id,
        client_id: fixture.clientId,
        freelancer_id: fixture.agencyId ? null : fixture.ownerId,
        agency_id: fixture.agencyId,
        title: "Second contract title",
        total_amount_cents: AMOUNT,
        status: "ACTIVE",
        started_at: new Date(),
      })
      .returning({ id: contracts.id });
    await db.insert(contract_milestones).values({
      contract_id: contract!.id,
      title: "Only milestone",
      amount_cents: AMOUNT,
      due_date: "2026-12-01",
      position: 0,
      status: "ACTIVE",
      funded_at: new Date(),
    });
    return contract!.id;
  };

  const addTeammate = async (agencyId: string) => {
    const teammateId = await insertAccount("FREELANCER");
    await db.insert(agency_members).values({
      agency_id: agencyId,
      freelancer_id: teammateId,
      role: "Developer",
    });
    return teammateId;
  };

  describe("counterparty company name", () => {
    it("shows each client's own company name to the freelancer and to the agency, with every milestone once", async () => {
      const direct = await seed({
        milestones: [
          { status: "COMPLETED", funded: true },
          { status: "ACTIVE", funded: true },
        ],
      });
      const viaAgency = await seed({ agency: true });
      await insertCompany(direct.clientId, "Direct Co");
      await insertCompany(viaAgency.clientId, "Agency Client Co");

      const freelancerView = await asFreelancer(direct.ownerId);
      expect(freelancerView.map((c) => [c.id, c.counterpartyName])).toEqual([
        [direct.contractId, "Direct Co"],
      ]);
      expect(freelancerView[0]?.milestones.map((m) => m.id)).toEqual(
        direct.milestoneIds,
      );

      const agencyView = await asAgency(viaAgency.ownerId);
      expect(agencyView.map((c) => [c.id, c.counterpartyName])).toEqual([
        [viaAgency.contractId, "Agency Client Co"],
      ]);
      expect(agencyView[0]?.milestones.map((m) => m.id)).toEqual(
        viaAgency.milestoneIds,
      );
    });

    it("never shows the company name to the client, who sees the freelancer's name", async () => {
      const fixture = await seed();
      await insertCompany(fixture.clientId, "Client Co");
      const view = await asClient(fixture.clientId);
      expect(view.map((c) => c.counterpartyName)).toEqual(["Test User"]);
    });

    it("falls back to the Clerk name, then to a generic name, when the client has no company", async () => {
      const fixture = await seed();
      expect(
        (await asFreelancer(fixture.ownerId)).map((c) => c.counterpartyName),
      ).toEqual(["Test User"]);

      mocks.getUser.mockRejectedValue(new Error("clerk unavailable"));
      expect(
        (await asFreelancer(fixture.ownerId)).map((c) => c.counterpartyName),
      ).toEqual(["Marketplace user"]);
    });
  });

  describe("reviewedByCurrentUser for the agency scope", () => {
    it("is false before a review and true once a teammate has reviewed the client", async () => {
      const fixture = await seed({ agency: true });
      expect(flagOf(await asAgency(fixture.ownerId), fixture.contractId)).toBe(
        false,
      );
      const teammateId = await addTeammate(fixture.agencyId!);
      await addReview(
        fixture.contractId,
        teammateId,
        fixture.clientId,
        fixture.agencyId,
      );
      expect(flagOf(await asAgency(fixture.ownerId), fixture.contractId)).toBe(
        true,
      );
    });

    it("ignores a review written for another agency", async () => {
      const fixture = await seed({ agency: true });
      const other = await seed({ agency: true });
      await addReview(
        fixture.contractId,
        other.ownerId,
        fixture.clientId,
        other.agencyId,
      );
      expect(flagOf(await asAgency(fixture.ownerId), fixture.contractId)).toBe(
        false,
      );
    });

    it("ignores a review of another contract by the same agency", async () => {
      const fixture = await seed({ agency: true });
      const secondId = await addSecondContract(fixture);
      await addReview(
        secondId,
        fixture.ownerId,
        fixture.clientId,
        fixture.agencyId,
      );
      const view = await asAgency(fixture.ownerId);
      expect(flagOf(view, secondId)).toBe(true);
      expect(flagOf(view, fixture.contractId)).toBe(false);
    });

    it("ignores the client's review of the agency, which is not a review of the client", async () => {
      const fixture = await seed({ agency: true });
      await addReview(
        fixture.contractId,
        fixture.clientId,
        fixture.ownerId,
        fixture.agencyId,
      );
      expect(flagOf(await asAgency(fixture.ownerId), fixture.contractId)).toBe(
        false,
      );
    });
  });

  describe("reviewedByCurrentUser for a client or a freelancer", () => {
    it("is true for the reviewer's own review, from either side", async () => {
      const byFreelancer = await seed();
      await addReview(
        byFreelancer.contractId,
        byFreelancer.ownerId,
        byFreelancer.clientId,
      );
      expect(
        flagOf(
          await asFreelancer(byFreelancer.ownerId),
          byFreelancer.contractId,
        ),
      ).toBe(true);

      const byClient = await seed();
      await addReview(byClient.contractId, byClient.clientId, byClient.ownerId);
      expect(
        flagOf(await asClient(byClient.clientId), byClient.contractId),
      ).toBe(true);
    });

    it("is false when only the other party reviewed the same contract", async () => {
      const fixture = await seed();
      await addReview(fixture.contractId, fixture.clientId, fixture.ownerId);
      expect(
        flagOf(await asFreelancer(fixture.ownerId), fixture.contractId),
      ).toBe(false);

      const reverse = await seed();
      await addReview(reverse.contractId, reverse.ownerId, reverse.clientId);
      expect(flagOf(await asClient(reverse.clientId), reverse.contractId)).toBe(
        false,
      );
    });

    it("is false for a contract the caller did not review while another one is reviewed", async () => {
      const fixture = await seed();
      const secondId = await addSecondContract(fixture);
      await addReview(secondId, fixture.ownerId, fixture.clientId);
      const view = await asFreelancer(fixture.ownerId);
      expect(flagOf(view, secondId)).toBe(true);
      expect(flagOf(view, fixture.contractId)).toBe(false);
    });
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

describe("POST /contracts/checkout account write", () => {
  const OLD = new Date("2000-01-01T00:00:00.000Z");

  it("creates a Stripe customer once and stores its id with a fresh updated_at", async () => {
    const fixture = await seed({ proposalStatus: "INTERVIEWED" });
    const other = await seed({ proposalStatus: "INTERVIEWED" });
    await pool.query(
      "update accounts set stripe_customer_id = null, updated_at = $1 where auth_id = any($2)",
      [OLD, [fixture.clientId, other.clientId]],
    );
    const startedAt = Date.now();
    const checkout = () =>
      request(app)
        .post(`${API}/checkout`)
        .query({ role: "client" })
        .set(as(fixture.clientId))
        .send({ proposalId: fixture.proposalId });

    const first = await checkout();

    expect(first.status).toBe(200);
    expect(mocks.customersCreate).toHaveBeenCalledWith({
      email: `${fixture.clientId}@example.test`,
      metadata: { accountId: fixture.clientId, role: "CLIENT" },
    });
    const created = await mocks.customersCreate.mock.results[0]!.value;
    const read = async (authId: string) =>
      (await pool.query("select * from accounts where auth_id = $1", [authId]))
        .rows[0] as { stripe_customer_id: string | null; updated_at: Date };
    const stored = await read(fixture.clientId);
    expect(stored.stripe_customer_id).toBe(created.id);
    expect(stored.updated_at.getTime()).toBeGreaterThanOrEqual(startedAt);
    expect(mocks.sessionsCreate).toHaveBeenCalledWith(
      expect.objectContaining({ customer: created.id }),
    );
    const untouched = await read(other.clientId);
    expect(untouched.stripe_customer_id).toBeNull();
    expect(untouched.updated_at.getTime()).toBe(OLD.getTime());

    expect((await checkout()).status).toBe(200);
    expect(mocks.customersCreate).toHaveBeenCalledTimes(1);
    expect((await read(fixture.clientId)).updated_at).toEqual(
      stored.updated_at,
    );
  });
});
