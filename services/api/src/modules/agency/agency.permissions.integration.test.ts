import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
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

vi.mock("../../config/env.js", async (importOriginal) => {
  const original = await importOriginal<typeof import("../../config/env.js")>();
  return {
    ...original,
    env: {
      ...original.env,
      clerkSecretKey: "sk_test",
      stripeSecretKey: "sk_stripe_test",
      agencyDashboard: "http://localhost:3999",
    },
  };
});

vi.mock("../../infrastructure/clerk.js", () => ({
  clerk: { users: { getUser: mocks.getUser } },
  verifyToken: mocks.verifyToken,
}));

vi.mock("../../infrastructure/stripe.js", () => ({
  STRIPE_TIMEOUT_MS: 30_000,
  stripe: {
    customers: { create: mocks.customersCreate },
    checkout: { sessions: { create: mocks.sessionsCreate } },
  },
}));

vi.mock("../../infrastructure/image-kit.js", () => ({
  imageKit: { files: { upload: vi.fn(), delete: vi.fn() } },
}));

vi.mock("../../infrastructure/redis.js", () => ({
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

vi.mock("../../infrastructure/events/publisher.js", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("../../infrastructure/events/publisher.js")
  >()),
  sendNotification: mocks.sendNotification,
}));

vi.mock("../messaging/messaging.socket.js", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("../messaging/messaging.socket.js")
  >()),
  emitConversationUpdate: mocks.emitConversationUpdate,
}));

import { db, pool } from "../../database/client.js";
import {
  accounts,
  agency_invitations,
  agency_members,
  agency_metadata,
  connects,
  connects_history,
  contract_milestones,
  contracts,
  conversation_participants,
  conversations,
  earning_history,
  job_posts,
  proposals,
  reviews,
} from "../../database/schema.js";
import { assertTestDatabase } from "../../test/assert-test-database.js";
import { AGENCY_PERMISSIONS } from "./agency.permissions.js";

const { app } = await import("../../app.js");

const PREFIX = "agency-perm-it-";
const API = "/api/v1";
const START_CONNECTS = 50;

const as = (userId: string) => ({ Authorization: `Bearer ${userId}` });
const newAuthId = () => `${PREFIX}${randomUUID()}`;

type RoleCase = {
  label: string;
  role: string;
  isOwner: boolean;
  hasMemberRow: boolean;
  allowed: boolean;
};

const ROLE_CASES: RoleCase[] = [
  {
    label: "owner (owner_id, member row)",
    role: "Founder",
    isOwner: true,
    hasMemberRow: true,
    allowed: true,
  },
  {
    label: "owner (owner_id, no member row)",
    role: "",
    isOwner: true,
    hasMemberRow: false,
    allowed: true,
  },
  {
    label: "Business manager",
    role: "Business manager",
    isOwner: false,
    hasMemberRow: true,
    allowed: true,
  },
  {
    label: "Agency member",
    role: "Agency member",
    isOwner: false,
    hasMemberRow: true,
    allowed: false,
  },
  {
    label: "unknown role Intern",
    role: "Intern",
    isOwner: false,
    hasMemberRow: true,
    allowed: false,
  },
  {
    label: "'business manager ' variant",
    role: "business manager ",
    isOwner: false,
    hasMemberRow: true,
    allowed: false,
  },
  {
    label: "Founder who is not owner_id",
    role: "Founder",
    isOwner: false,
    hasMemberRow: true,
    allowed: false,
  },
  {
    label: "member whose role string is 'owner'",
    role: "owner",
    isOwner: false,
    hasMemberRow: true,
    allowed: false,
  },
  {
    label: "member whose role string is 'Owner'",
    role: "Owner",
    isOwner: false,
    hasMemberRow: true,
    allowed: false,
  },
];

const PLAIN_MEMBER = ROLE_CASES[3]!;
const OWNER_CASE = ROLE_CASES[0]!;

const insertAccount = async (
  role: "CLIENT" | "FREELANCER" = "FREELANCER",
  identityVerified = true,
) => {
  const authId = newAuthId();
  await db.insert(accounts).values({
    auth_id: authId,
    email: `${authId}@example.test`,
    role,
    identityVerified,
    created_at: new Date(),
    updated_at: new Date(),
  });
  return authId;
};

const setupAgency = async (roleCase: RoleCase) => {
  const ownerId = await insertAccount();
  const [agency] = await db
    .insert(agency_metadata)
    .values({
      owner_id: ownerId,
      name: `${PREFIX}agency-${randomUUID()}`,
      size: "1-10",
      specialty: "testing",
      overview: "integration test agency",
    })
    .returning({ id: agency_metadata.id });
  const agencyId = agency!.id;
  const [balance] = await db
    .insert(connects)
    .values({ agency_id: agencyId, connects: START_CONNECTS })
    .returning({ id: connects.id });

  const actorId = roleCase.isOwner ? ownerId : await insertAccount();
  if (roleCase.hasMemberRow) {
    await db.insert(agency_members).values({
      agency_id: agencyId,
      freelancer_id: actorId,
      role: roleCase.role,
    });
  }
  return { ownerId, agencyId, actorId, connectsId: balance!.id };
};

const insertJobAndProposal = async (
  clientId: string,
  agencyId: string | null,
  status: "PUBLISHED" | "DRAFT" = "PUBLISHED",
) => {
  const [job] = await db
    .insert(job_posts)
    .values({
      client_id: clientId,
      title: "Permission job",
      description: "Permission test job",
      expertise_level: "INTERMEDIATE",
      expected_duration: "1 week",
      total_budget_cents: 20000,
      milestones: [],
      status,
    })
    .returning({ id: job_posts.id });
  if (!agencyId) return { jobId: job!.id, proposalId: null };
  const [proposal] = await db
    .insert(proposals)
    .values({
      job_id: job!.id,
      sender_id: agencyId,
      sender_type: "AGENCY",
      cover_letter: "integration",
      bid_amount_cents: 20000,
      duration: "1 week",
    })
    .returning({ id: proposals.id });
  return { jobId: job!.id, proposalId: proposal!.id };
};

const insertContract = async (
  agencyId: string,
  kind: "pending" | "finishable",
) => {
  const clientId = await insertAccount("CLIENT");
  const { jobId, proposalId } = await insertJobAndProposal(clientId, agencyId);
  const [contract] = await db
    .insert(contracts)
    .values({
      proposal_id: proposalId!,
      job_id: jobId,
      client_id: clientId,
      freelancer_id: null,
      agency_id: agencyId,
      title: "Permission contract",
      total_amount_cents: 20000,
      status: kind === "pending" ? "PENDING" : "ACTIVE",
    })
    .returning({ id: contracts.id });
  const [conversation] = await db
    .insert(conversations)
    .values({
      proposal_id: proposalId!,
      job_id: jobId,
      context_key: `${PREFIX}${randomUUID()}`,
    })
    .returning({ id: conversations.id });
  await db.insert(conversation_participants).values([
    {
      conversation_id: conversation!.id,
      account_id: clientId,
      participant_type: "CLIENT",
    },
    {
      conversation_id: conversation!.id,
      agency_id: agencyId,
      participant_type: "AGENCY",
    },
  ]);
  const [milestone] = await db
    .insert(contract_milestones)
    .values({
      contract_id: contract!.id,
      title: "Permission milestone",
      amount_cents: 20000,
      due_date: "2026-01-01",
      position: 0,
      status: kind === "pending" ? "PENDING" : "COMPLETED",
      funded_at: new Date(),
      completed_at: kind === "pending" ? null : new Date(),
    })
    .returning({ id: contract_milestones.id });
  return { contractId: contract!.id, milestoneId: milestone!.id };
};

const seedEarning = async (agencyId: string, amountCents: number) => {
  const { contractId, milestoneId } = await insertContract(
    agencyId,
    "finishable",
  );
  const [row] = await db
    .insert(earning_history)
    .values({
      agency_id: agencyId,
      contract_id: contractId,
      milestone_id: milestoneId,
      amount_cents: amountCents,
      platform_fee_cents: 0,
      description: "Permission earning",
    })
    .returning({ id: earning_history.id });
  return row!.id;
};

const contractSnapshot = async (contractId: string) => {
  const [contract] = await db
    .select()
    .from(contracts)
    .where(eq(contracts.id, contractId));
  const milestones = await db
    .select()
    .from(contract_milestones)
    .where(eq(contract_milestones.contract_id, contractId));
  const reviewRows = await db
    .select()
    .from(reviews)
    .where(eq(reviews.contract_id, contractId));
  return { contract, milestones, reviewCount: reviewRows.length };
};

const connectsState = async (connectsId: string) => {
  const [balance] = await db
    .select({ connects: connects.connects })
    .from(connects)
    .where(eq(connects.id, connectsId));
  const history = await db
    .select({ id: connects_history.id })
    .from(connects_history)
    .where(eq(connects_history.connects_id, connectsId));
  return { balance: balance?.connects, historyCount: history.length };
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

const expectDenied = (response: {
  status: number;
  body: { code?: string };
}) => {
  expect(response.status).toBe(403);
  expect(response.body.code).toBe("AGENCY_PERMISSION_DENIED");
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
  mocks.getUser.mockResolvedValue({ firstName: "Test", lastName: "User" });
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

describe("agency permission map", () => {
  it("covers every approved permission", () => {
    expect(Object.keys(AGENCY_PERMISSIONS).sort()).toEqual([
      "connects.checkout",
      "contract.accept",
      "contract.finish",
      "earnings.view",
      "proposal.send",
      "team.invitations.view",
    ]);
  });
});

describe.each(ROLE_CASES)("agency role: $label", (roleCase) => {
  it("proposal.send", async () => {
    const { agencyId, actorId, connectsId } = await setupAgency(roleCase);
    const clientId = await insertAccount("CLIENT");
    const { jobId } = await insertJobAndProposal(clientId, null);

    const response = await request(app)
      .post(`${API}/agency/proposals`)
      .set(as(actorId))
      .send({
        role: "freelancer",
        jobId,
        coverLetter: "x".repeat(100),
        bidAmountCents: 15000,
        duration: "1 week",
        screeningAnswers: [],
      });

    const state = await connectsState(connectsId);
    if (roleCase.allowed) {
      expect(response.status).toBe(201);
      expect(state.balance).toBeLessThan(START_CONNECTS);
      expect(state.historyCount).toBe(1);
    } else {
      expectDenied(response);
      expect(state).toEqual({ balance: START_CONNECTS, historyCount: 0 });
      const rows = await db
        .select({ id: proposals.id })
        .from(proposals)
        .where(eq(proposals.sender_id, agencyId));
      expect(rows).toHaveLength(0);
      expect(mocks.sendNotification).not.toHaveBeenCalled();
    }
  });

  it("connects.checkout", async () => {
    const { actorId } = await setupAgency(roleCase);

    const response = await request(app)
      .post(`${API}/agency/connects/checkout`)
      .set(as(actorId))
      .send({ role: "freelancer", connects: 20 });

    if (roleCase.allowed) {
      expect(response.status).toBe(200);
      expect(mocks.sessionsCreate).toHaveBeenCalledTimes(1);
    } else {
      expectDenied(response);
      expect(mocks.customersCreate).not.toHaveBeenCalled();
      expect(mocks.sessionsCreate).not.toHaveBeenCalled();
    }
  });

  it.each(["summary", "overview"])("earnings.view (%s)", async (path) => {
    const { agencyId, actorId } = await setupAgency(roleCase);
    const ownEarningId = await seedEarning(agencyId, 20000);
    const other = await setupAgency(OWNER_CASE);
    await seedEarning(other.agencyId, 7000);

    const response = await request(app)
      .get(`${API}/agency/earnings/${path}?role=freelancer`)
      .set(as(actorId));

    if (roleCase.allowed) {
      expect(response.status).toBe(200);
      if (path === "summary") {
        expect(response.body.data.hasEarnings).toBe(true);
        expect(response.body.data.currentMonthTotalCents).toBe(20000);
      } else {
        expect(response.body.data.lifetimeCents).toBe(20000);
        expect(
          response.body.data.recentEarnings.map((e: { id: string }) => e.id),
        ).toEqual([ownEarningId]);
      }
    } else {
      expectDenied(response);
    }
  });

  it("team.invitations.view", async () => {
    const { agencyId, ownerId, actorId } = await setupAgency(roleCase);
    const email = `${PREFIX}${randomUUID()}@example.test`;
    await db
      .insert(agency_invitations)
      .values({ agency_id: agencyId, email, invited_by: ownerId });
    const other = await setupAgency(OWNER_CASE);
    await db.insert(agency_invitations).values({
      agency_id: other.agencyId,
      email: `${PREFIX}${randomUUID()}@example.test`,
      invited_by: other.ownerId,
    });

    const response = await request(app)
      .get(`${API}/agency/team/invitations?role=freelancer`)
      .set(as(actorId));

    if (roleCase.allowed) {
      expect(response.status).toBe(200);
      expect(
        response.body.data.map((row: { email: string }) => row.email),
      ).toEqual([email]);
    } else {
      expectDenied(response);
    }
  });

  it("contract.accept with scope=agency", async () => {
    const { agencyId, actorId } = await setupAgency(roleCase);
    const { contractId } = await insertContract(agencyId, "pending");
    const before = await contractSnapshot(contractId);

    const response = await request(app)
      .patch(`${API}/contracts/${contractId}/accept?scope=agency`)
      .set(as(actorId))
      .send({ role: "freelancer" });

    const after = await contractSnapshot(contractId);
    if (roleCase.allowed) {
      expect(response.status).toBe(200);
      expect(after.contract!.status).toBe("ACTIVE");
    } else {
      expectDenied(response);
      expect(after).toEqual(before);
      expect(mocks.sendNotification).not.toHaveBeenCalled();
      expect(mocks.emitConversationUpdate).not.toHaveBeenCalled();
    }
  });

  it("contract.finish with scope=agency", async () => {
    const { agencyId, actorId } = await setupAgency(roleCase);
    const { contractId } = await insertContract(agencyId, "finishable");
    const before = await contractSnapshot(contractId);

    const response = await request(app)
      .post(`${API}/contracts/${contractId}/finish?scope=agency`)
      .set(as(actorId))
      .send({
        role: "freelancer",
        rating: 5,
        comment: "Great client to work with.",
      });

    const after = await contractSnapshot(contractId);
    if (roleCase.allowed) {
      expect(response.status).toBe(200);
      expect(after.reviewCount).toBe(1);
    } else {
      expectDenied(response);
      expect(after).toEqual(before);
      expect(mocks.sendNotification).not.toHaveBeenCalled();
      expect(mocks.emitConversationUpdate).not.toHaveBeenCalled();
    }
  });
});

describe("non-members and individual freelancers", () => {
  it.each(["summary", "overview"])(
    "keeps empty 200 on earnings %s for a non-member",
    async (path) => {
      const userId = await insertAccount();

      const response = await request(app)
        .get(`${API}/agency/earnings/${path}?role=freelancer`)
        .set(as(userId));

      expect(response.status).toBe(200);
    },
  );

  it("keeps an empty 200 on invitations for a non-member", async () => {
    const userId = await insertAccount();

    const response = await request(app)
      .get(`${API}/agency/team/invitations?role=freelancer`)
      .set(as(userId));

    expect(response.status).toBe(200);
    expect(response.body.data).toEqual([]);
  });

  it("keeps 404 on checkout for a non-member", async () => {
    const userId = await insertAccount();

    const checkout = await request(app)
      .post(`${API}/agency/connects/checkout`)
      .set(as(userId))
      .send({ role: "freelancer", connects: 20 });

    expect(checkout.status).toBe(404);
    expect(mocks.sessionsCreate).not.toHaveBeenCalled();
  });

  const expectSoloContractsWork = async (freelancerId: string) => {
    const clientId = await insertAccount("CLIENT");
    const { jobId } = await insertJobAndProposal(clientId, null);
    const make = async (kind: "pending" | "finishable") => {
      const [proposal] = await db
        .insert(proposals)
        .values({
          job_id: jobId,
          sender_id: freelancerId + kind,
          sender_type: "FREELANCER",
          cover_letter: "integration",
          bid_amount_cents: 20000,
          duration: "1 week",
        })
        .returning({ id: proposals.id });
      const [contract] = await db
        .insert(contracts)
        .values({
          proposal_id: proposal!.id,
          job_id: jobId,
          client_id: clientId,
          freelancer_id: freelancerId,
          title: "Solo contract",
          total_amount_cents: 20000,
          status: kind === "pending" ? "PENDING" : "ACTIVE",
        })
        .returning({ id: contracts.id });
      const [conversation] = await db
        .insert(conversations)
        .values({
          proposal_id: proposal!.id,
          job_id: jobId,
          context_key: `${PREFIX}${randomUUID()}`,
        })
        .returning({ id: conversations.id });
      await db.insert(conversation_participants).values([
        {
          conversation_id: conversation!.id,
          account_id: clientId,
          participant_type: "CLIENT",
        },
        {
          conversation_id: conversation!.id,
          account_id: freelancerId,
          participant_type: "FREELANCER",
        },
      ]);
      await db.insert(contract_milestones).values({
        contract_id: contract!.id,
        title: "Solo milestone",
        amount_cents: 20000,
        due_date: "2026-01-01",
        position: 0,
        status: kind === "pending" ? "PENDING" : "COMPLETED",
        funded_at: new Date(),
        completed_at: kind === "pending" ? null : new Date(),
      });
      return contract!.id;
    };
    const pendingId = await make("pending");
    const activeId = await make("finishable");

    const accept = await request(app)
      .patch(`${API}/contracts/${pendingId}/accept`)
      .set(as(freelancerId))
      .send({ role: "freelancer" });
    const finish = await request(app)
      .post(`${API}/contracts/${activeId}/finish`)
      .set(as(freelancerId))
      .send({
        role: "freelancer",
        rating: 5,
        comment: "Great client to work with.",
      });

    expect(accept.status).toBe(200);
    expect(finish.status).toBe(200);
  };

  it("does not guard an individual freelancer accepting and finishing", async () => {
    await expectSoloContractsWork(await insertAccount());
  });

  it("does not guard a plain agency member on their own solo contracts", async () => {
    const { actorId } = await setupAgency(PLAIN_MEMBER);
    await expectSoloContractsWork(actorId);
  });

  it("returns 404 and writes nothing for a plain member accepting and finishing an agency contract without scope", async () => {
    const { agencyId, actorId } = await setupAgency(PLAIN_MEMBER);
    const pending = await insertContract(agencyId, "pending");
    const finishable = await insertContract(agencyId, "finishable");
    const beforePending = await contractSnapshot(pending.contractId);
    const beforeFinishable = await contractSnapshot(finishable.contractId);

    const accept = await request(app)
      .patch(`${API}/contracts/${pending.contractId}/accept`)
      .set(as(actorId))
      .send({ role: "freelancer" });
    const finish = await request(app)
      .post(`${API}/contracts/${finishable.contractId}/finish`)
      .set(as(actorId))
      .send({
        role: "freelancer",
        rating: 5,
        comment: "Great client to work with.",
      });

    expect(accept.status).toBe(404);
    expect(finish.status).toBe(404);
    expect(await contractSnapshot(pending.contractId)).toEqual(beforePending);
    expect(await contractSnapshot(finishable.contractId)).toEqual(
      beforeFinishable,
    );
    expect(mocks.sendNotification).not.toHaveBeenCalled();
  });

  it("keeps 404 on proposals for a non-member", async () => {
    const userId = await insertAccount();
    const clientId = await insertAccount("CLIENT");
    const { jobId } = await insertJobAndProposal(clientId, null);

    const response = await request(app)
      .post(`${API}/agency/proposals`)
      .set(as(userId))
      .send({
        role: "freelancer",
        jobId,
        coverLetter: "x".repeat(100),
        bidAmountCents: 15000,
        duration: "1 week",
        screeningAnswers: [],
      });

    expect(response.status).toBe(404);
  });

  it("keeps 403 No agency account found on scope=agency accept and finish for a non-member", async () => {
    const { agencyId } = await setupAgency(OWNER_CASE);
    const pending = await insertContract(agencyId, "pending");
    const finishable = await insertContract(agencyId, "finishable");
    const userId = await insertAccount();

    const accept = await request(app)
      .patch(`${API}/contracts/${pending.contractId}/accept?scope=agency`)
      .set(as(userId))
      .send({ role: "freelancer" });
    const finish = await request(app)
      .post(`${API}/contracts/${finishable.contractId}/finish?scope=agency`)
      .set(as(userId))
      .send({
        role: "freelancer",
        rating: 5,
        comment: "Great client to work with.",
      });

    expect(accept.status).toBe(403);
    expect(accept.body.message).toBe("No agency account found.");
    expect(finish.status).toBe(403);
    expect(finish.body.message).toBe("No agency account found.");
  });

  it("resolves a user who owns agency A and is a plain member of agency B to agency B", async () => {
    const userId = await insertAccount();
    await db.insert(agency_metadata).values({
      owner_id: userId,
      name: `${PREFIX}agency-${randomUUID()}`,
      size: "1-10",
      specialty: "testing",
      overview: "owned agency",
    });
    const agencyB = await setupAgency(PLAIN_MEMBER);
    await db.insert(agency_members).values({
      agency_id: agencyB.agencyId,
      freelancer_id: userId,
      role: "Agency member",
    });

    const invitations = await request(app)
      .get(`${API}/agency/team/invitations?role=freelancer`)
      .set(as(userId));
    const checkout = await request(app)
      .post(`${API}/agency/connects/checkout`)
      .set(as(userId))
      .send({ role: "freelancer", connects: 20 });

    expectDenied(invitations);
    expectDenied(checkout);
    expect(mocks.sessionsCreate).not.toHaveBeenCalled();
  });
});
