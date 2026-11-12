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
  upload: vi.fn(),
  customersCreate: vi.fn(),
  sessionsCreate: vi.fn(),
  accountsCreate: vi.fn(),
  loginLink: vi.fn(),
}));

vi.mock("../../config/env.js", async (importOriginal) => {
  const original = await importOriginal<typeof import("../../config/env.js")>();
  return {
    ...original,
    env: {
      ...original.env,
      clerkSecretKey: "sk_test",
      stripeSecretKey: "sk_stripe_test",
      imageKitPrivateKey: "ik_test",
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
    v2: { core: { accounts: { create: mocks.accountsCreate } } },
    accounts: { createLoginLink: mocks.loginLink },
  },
}));

vi.mock("../../infrastructure/image-kit.js", () => ({
  imageKit: { files: { upload: mocks.upload, delete: vi.fn() } },
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

import { db, pool } from "../../database/client.js";
import {
  accounts,
  agency_earning,
  client_spents,
  contract_milestones,
  contracts,
  earning_history,
  freelancer_earning,
  reviews,
  agency_invitations,
  agency_members,
  agency_metadata,
  client_metadata,
  connects,
  connects_history,
  freelancer_metadata,
  job_posts,
  payout_history,
  proposals,
} from "../../test/support/tables.js";
import { assertTestDatabase } from "../../test/setup/assert-test-database.js";
import {
  agencyConnectsCheckoutResponses,
  agencyConnectsHistoryResponses,
  agencyConnectsResponses,
  agencyCreateResponses,
  agencyEarningsOverviewResponses,
  agencyEarningsSummaryResponses,
  agencyInvitationMutationResponses,
  agencyInviteResponses,
  agencyJobFeedResponses,
  agencyMemberMutationResponses,
  agencyMembershipResponses,
  agencyMineResponses,
  agencyMyInvitationsResponses,
  agencyPayoutLinkResponses,
  agencyProposalMetadataResponses,
  agencyProposalsResponses,
  agencyPublicProfileResponses,
  agencyRespondResponses,
  agencyResendInvitationResponses,
  agencySearchResponses,
  agencySubmitProposalResponses,
  agencyTeamInvitationsResponses,
  agencyUpdateResponses,
  agencyVerificationResponses,
} from "./agency.responses.js";

const { app } = await import("../../app.js");

const PREFIX = "agency-contract-";
const API = "/api/v1/agency";

const PNG =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

const newAuthId = () => `${PREFIX}${randomUUID()}`;
const emailOf = (authId: string) => `${authId}@example.test`;
const as = (userId: string) => ({ Authorization: `Bearer ${userId}` });
const q = { role: "freelancer" };

const insertAccount = async (
  authId: string,
  role: "CLIENT" | "FREELANCER" = "FREELANCER",
  extra: Partial<typeof accounts.$inferInsert> = {},
) => {
  await db.insert(accounts).values({
    auth_id: authId,
    email: emailOf(authId),
    role,
    created_at: new Date(),
    updated_at: new Date(),
    ...extra,
  });
  return authId;
};

const insertFreelancer = async (extra: { identityVerified?: boolean } = {}) => {
  const authId = await insertAccount(newAuthId(), "FREELANCER", extra);
  await db.insert(freelancer_metadata).values({
    auth_id: authId,
    professional_title: "Designer",
    professional_description: "desc",
    hourly_rate_cents: 4500,
    country: "US",
    city: "Austin",
    weekly_availability: "30",
    experience_level: "EXPERT",
    skills: ["figma"],
    languages: [{ language: "English", proficiency: "Fluent" }],
  });
  await db.insert(freelancer_earning).values({
    freelancer_id: authId,
    rating: "4.50",
    job_success_score: "90.00",
    completed_jobs: 2,
  });
  return authId;
};

const purge = async () => {
  const like = `${PREFIX}%`;
  await pool.query("delete from contracts where client_id like $1", [like]);
  await pool.query("delete from proposals where sender_id like $1", [like]);
  await pool.query("delete from job_posts where client_id like $1", [like]);
  await pool.query("delete from agency_metadata where owner_id like $1", [
    like,
  ]);
  await pool.query("delete from freelancer_metadata where auth_id like $1", [
    like,
  ]);
  await pool.query("delete from client_metadata where auth_id like $1", [like]);
  await pool.query("delete from accounts where auth_id like $1", [like]);
};

const seedAgency = async (
  options: { onboarded?: boolean; verified?: boolean } = {},
) => {
  const ownerId = await insertFreelancer({
    identityVerified: options.verified ?? false,
  });
  const [agency] = await db
    .insert(agency_metadata)
    .values({
      owner_id: ownerId,
      name: `${PREFIX}studio`,
      professional_title: "Design studio",
      size: "1-10",
      specialty: "design",
      website: "https://studio.example.test",
      overview: "We design things.",
      tags: ["figma", "branding"],
      avatar_image: { imageId: "img_1", url: "https://example.test/a.png" },
      is_onboarded: options.onboarded ?? true,
    })
    .returning({ id: agency_metadata.id });
  await db
    .insert(agency_members)
    .values({ agency_id: agency!.id, freelancer_id: ownerId, role: "Founder" });
  const [balance] = await db
    .insert(connects)
    .values({ agency_id: agency!.id, connects: 100 })
    .returning({ id: connects.id });
  await db.insert(connects_history).values({
    connects_id: balance!.id,
    type: "Onboarding Bonus",
    description: "New agency welcome Connects",
    amount: 100,
  });
  await db.insert(agency_earning).values({
    agency_id: agency!.id,
    rating: "4.80",
    job_success_score: "92.00",
    completed_jobs: 1,
  });
  return { ownerId, agencyId: agency!.id };
};

const addMember = async (agencyId: string, role: string) => {
  const freelancerId = await insertFreelancer();
  const [member] = await db
    .insert(agency_members)
    .values({ agency_id: agencyId, freelancer_id: freelancerId, role })
    .returning({ id: agency_members.id });
  return { freelancerId, memberId: member!.id };
};

const seedClientWithJob = async (
  options: { skills?: string[]; title?: string } = {},
) => {
  const clientId = await insertAccount(newAuthId(), "CLIENT", {
    paymentMethodVerified: true,
  });
  await db.insert(client_metadata).values({
    auth_id: clientId,
    role: "Founder",
    company_name: "Acme",
    company_website: "https://acme.example.test",
    company_size: "11-50",
    industry: "Software",
    company_description: "We build things.",
    created_at: new Date(),
    updated_at: new Date(),
  });
  await db.insert(client_spents).values({
    client_id: clientId,
    total_spent_cents: 50000,
    review_count: 1,
    rating: "4.00",
  });
  const [job] = await db
    .insert(job_posts)
    .values({
      client_id: clientId,
      title: options.title ?? "Brand design job",
      description: "We need figma and branding work",
      expertise_level: "EXPERT",
      expected_duration: "1 month",
      skills: options.skills ?? ["figma", "branding"],
      total_budget_cents: 100000,
      milestones: [
        {
          id: "m1",
          title: "First",
          budgetCents: 100000,
          dueDate: "2026-12-01",
        },
      ],
      screening_questions: [],
      attachments: [],
      status: "PUBLISHED",
      published_at: new Date(),
    })
    .returning({ id: job_posts.id });
  return { clientId, jobId: job!.id };
};

const seedAgencyWork = async (agencyId: string, ownerId: string) => {
  const { clientId, jobId } = await seedClientWithJob({
    title: "Finished brand job",
  });
  const [proposal] = await db
    .insert(proposals)
    .values({
      job_id: jobId,
      sender_id: agencyId,
      sender_type: "AGENCY",
      cover_letter: "hello",
      bid_amount_cents: 100000,
      duration: "1 month",
    })
    .returning({ id: proposals.id });
  const [contract] = await db
    .insert(contracts)
    .values({
      proposal_id: proposal!.id,
      job_id: jobId,
      client_id: clientId,
      agency_id: agencyId,
      title: "Agency finished contract",
      total_amount_cents: 100000,
      status: "COMPLETED",
      completed_at: new Date(),
    })
    .returning({ id: contracts.id });
  const milestoneRows = await db
    .insert(contract_milestones)
    .values([
      {
        contract_id: contract!.id,
        title: "m1",
        amount_cents: 80000,
        due_date: "2026-01-01",
        position: 0,
        status: "COMPLETED",
      },
      {
        contract_id: contract!.id,
        title: "m2",
        amount_cents: 20000,
        due_date: "2026-02-01",
        position: 1,
        status: "COMPLETED",
      },
    ])
    .returning({ id: contract_milestones.id });
  await db.insert(reviews).values([
    {
      contract_id: contract!.id,
      reviewer_id: clientId,
      reviewee_id: ownerId,
      agency_id: agencyId,
      rating: 5,
      comment: "great",
    },
    {
      contract_id: contract!.id,
      reviewer_id: ownerId,
      reviewee_id: clientId,
      agency_id: agencyId,
      rating: 4,
      comment: "good client",
    },
  ]);
  const [paid] = await db
    .insert(earning_history)
    .values({
      agency_id: agencyId,
      contract_id: contract!.id,
      milestone_id: milestoneRows[0]!.id,
      amount_cents: 80000,
      platform_fee_cents: 8000,
      description: "paid out",
    })
    .returning({ id: earning_history.id });
  await db.insert(payout_history).values({
    agency_id: agencyId,
    earning_history_id: paid!.id,
    amount_cents: 72000,
    status: "PAID",
    stripe_transfer_id: `tr_${randomUUID()}`,
    paid_at: new Date(),
  });
  await db
    .update(earning_history)
    .set({ created_at: new Date(Date.now() - 40 * 24 * 60 * 60 * 1000) })
    .where(eq(earning_history.id, paid!.id));
  await db.insert(earning_history).values({
    agency_id: agencyId,
    contract_id: contract!.id,
    milestone_id: milestoneRows[1]!.id,
    amount_cents: 20000,
    platform_fee_cents: 2000,
    description: "fresh",
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
  mocks.upload.mockReset();
  mocks.customersCreate.mockReset();
  mocks.sessionsCreate.mockReset();
  mocks.accountsCreate.mockReset();
  mocks.loginLink.mockReset();
  mocks.verifyToken.mockImplementation(async (token: string) => ({
    sub: token,
    sid: `sess_${token}`,
  }));
  mocks.getUser.mockResolvedValue({
    firstName: "Test",
    lastName: "User",
    fullName: "Test User",
    imageUrl: "https://example.test/u.png",
    unsafeMetadata: { country: "US" },
  });
  mocks.upload.mockImplementation(async () => ({
    fileId: `file_${randomUUID()}`,
    url: "https://ik.example.test/image.png",
  }));
  mocks.customersCreate.mockImplementation(async () => ({
    id: `cus_${randomUUID()}`,
  }));
  mocks.sessionsCreate.mockResolvedValue({ url: "https://stripe.test/pay" });
  mocks.accountsCreate.mockResolvedValue({
    id: "acct_test",
    requirements: { entries: [] },
  });
  mocks.loginLink.mockResolvedValue({ url: "https://connect.test/login" });
});

describe("agency contract: profile", () => {
  it("creates, updates and serves the agency profile everywhere", async () => {
    const ownerId = await insertFreelancer({ identityVerified: true });

    const created = await request(app)
      .post(API)
      .set(as(ownerId))
      .send({
        role: "freelancer",
        name: `${PREFIX}studio`,
        size: "1-10",
        specialty: "design",
        website: "https://studio.example.test",
        overview: "We design things.",
      });
    expect(created.status).toBe(201);
    agencyCreateResponses[201].parse(created.body);
    const agencyId = created.body.data.id as string;

    const duplicate = await request(app).post(API).set(as(ownerId)).send({
      role: "freelancer",
      name: "again",
      size: "1-10",
      specialty: "design",
      overview: "again",
    });
    expect(duplicate.status).toBe(409);
    agencyCreateResponses[409].parse(duplicate.body);

    const updated = await request(app)
      .put(API)
      .set(as(ownerId))
      .send({
        role: "freelancer",
        name: `${PREFIX}studio`,
        professionalTitle: "Design studio",
        size: "1-10",
        specialty: "design",
        website: "https://studio.example.test",
        overview: "We design things well.",
        tags: ["figma", "branding"],
        avatarImage: { url: PNG },
        portfolio: [
          {
            title: "Shop",
            category: "Web",
            description: "A shop.",
            liveUrl: "https://shop.example.test",
            coverImage: { url: PNG },
          },
        ],
      });
    expect(updated.status).toBe(200);
    expect(updated.body.data.portfolio).toHaveLength(1);
    agencyUpdateResponses[200].parse(updated.body);

    await addMember(agencyId, "Agency member");
    await seedAgencyWork(agencyId, ownerId);

    const mine = await request(app)
      .get(`${API}/mine`)
      .query(q)
      .set(as(ownerId));
    expect(mine.status).toBe(200);
    expect(mine.body.data.members).toHaveLength(2);
    expect(mine.body.data.workHistory).toHaveLength(1);
    expect(mine.body.data.portfolio).toHaveLength(1);
    agencyMineResponses[200].parse(mine.body);

    const publicProfile = await request(app).get(`${API}/profile/${agencyId}`);
    expect(publicProfile.status).toBe(200);
    agencyPublicProfileResponses[200].parse(publicProfile.body);

    const missingProfile = await request(app).get(
      `${API}/profile/${randomUUID()}`,
    );
    expect(missingProfile.status).toBe(404);
    agencyPublicProfileResponses[404].parse(missingProfile.body);

    const search = await request(app)
      .get(`${API}/search`)
      .query({ query: "studio" });
    expect(search.status).toBe(200);
    expect(search.body.data.results.length).toBeGreaterThan(0);
    agencySearchResponses[200].parse(search.body);

    const membership = await request(app)
      .get(`${API}/membership`)
      .query(q)
      .set(as(ownerId));
    expect(membership.status).toBe(200);
    expect(membership.body.data.agencyId).toBe(agencyId);
    agencyMembershipResponses[200].parse(membership.body);

    const verification = await request(app)
      .get(`${API}/verification`)
      .query(q)
      .set(as(ownerId));
    expect(verification.status).toBe(200);
    expect(verification.body.data.isOwner).toBe(true);
    agencyVerificationResponses[200].parse(verification.body);

    const lonely = await insertFreelancer();
    const noAgency = await request(app)
      .get(`${API}/mine`)
      .query(q)
      .set(as(lonely));
    expect(noAgency.body.data).toBeNull();
    agencyMineResponses[200].parse(noAgency.body);

    const noMembership = await request(app)
      .get(`${API}/membership`)
      .query(q)
      .set(as(lonely));
    expect(noMembership.body.data.agencyId).toBeNull();
    agencyMembershipResponses[200].parse(noMembership.body);

    const missingUpdate = await request(app).put(API).set(as(lonely)).send({
      role: "freelancer",
      name: "x",
      professionalTitle: "x",
      size: "1-10",
      specialty: "design",
      overview: "x",
    });
    expect(missingUpdate.status).toBe(404);
    agencyUpdateResponses[404].parse(missingUpdate.body);
  });
});

describe("agency contract: team", () => {
  it("covers invitations and member management", async () => {
    const { ownerId, agencyId } = await seedAgency();
    const inviteeId = await insertFreelancer();
    const otherId = await insertFreelancer();

    const invite = await request(app)
      .post(`${API}/team/invitations`)
      .set(as(ownerId))
      .send({
        role: "freelancer",
        email: emailOf(inviteeId),
        memberRole: "Business manager",
      });
    expect(invite.status).toBe(201);
    agencyInviteResponses[201].parse(invite.body);
    const invitationId = invite.body.data.id as string;

    const pending = await request(app)
      .post(`${API}/team/invitations`)
      .set(as(ownerId))
      .send({ role: "freelancer", email: emailOf(inviteeId) });
    expect(pending.status).toBe(409);
    expect(pending.body.code).toBe("INVITATION_ALREADY_PENDING");
    agencyInviteResponses[409].parse(pending.body);

    const list = await request(app)
      .get(`${API}/team/invitations`)
      .query(q)
      .set(as(ownerId));
    expect(list.status).toBe(200);
    expect(list.body.data).toHaveLength(1);
    agencyTeamInvitationsResponses[200].parse(list.body);

    const retitled = await request(app)
      .patch(`${API}/team/invitations/${invitationId}`)
      .set(as(ownerId))
      .send({ role: "freelancer", memberRole: "Business manager" });
    expect(retitled.status).toBe(200);
    agencyInvitationMutationResponses[200].parse(retitled.body);

    await db
      .update(agency_invitations)
      .set({ updated_at: new Date(Date.now() - 5 * 60 * 1000) })
      .where(eq(agency_invitations.id, invitationId));
    const resent = await request(app)
      .post(`${API}/team/invitations/${invitationId}/resend`)
      .set(as(ownerId))
      .send({ role: "freelancer" });
    expect(resent.status).toBe(200);
    agencyResendInvitationResponses[200].parse(resent.body);

    const cooldown = await request(app)
      .post(`${API}/team/invitations/${invitationId}/resend`)
      .set(as(ownerId))
      .send({ role: "freelancer" });
    expect(cooldown.status).toBe(429);
    expect(cooldown.body.code).toBe("INVITATION_RESEND_COOLDOWN");
    agencyResendInvitationResponses[429].parse(cooldown.body);

    const mine = await request(app)
      .get(`${API}/invitations/mine`)
      .query(q)
      .set(as(inviteeId));
    expect(mine.status).toBe(200);
    expect(mine.body.data).toHaveLength(1);
    agencyMyInvitationsResponses[200].parse(mine.body);

    const accepted = await request(app)
      .patch(`${API}/invitations/${invitationId}/respond`)
      .set(as(inviteeId))
      .send({ role: "freelancer", accept: true });
    expect(accepted.status).toBe(200);
    agencyRespondResponses[200].parse(accepted.body);

    const handled = await request(app)
      .patch(`${API}/invitations/${invitationId}/respond`)
      .set(as(inviteeId))
      .send({ role: "freelancer", accept: true });
    expect(handled.status).toBe(409);
    expect(handled.body.code).toBe("INVITATION_ALREADY_HANDLED");
    agencyRespondResponses[409].parse(handled.body);

    const alreadyMember = await request(app)
      .post(`${API}/team/invitations`)
      .set(as(ownerId))
      .send({ role: "freelancer", email: emailOf(inviteeId) });
    expect(alreadyMember.status).toBe(409);
    expect(alreadyMember.body.code).toBe("INVITEE_ALREADY_MEMBER");
    agencyInviteResponses[409].parse(alreadyMember.body);

    const missingRespond = await request(app)
      .patch(`${API}/invitations/${randomUUID()}/respond`)
      .set(as(inviteeId))
      .send({ role: "freelancer", accept: true });
    expect(missingRespond.status).toBe(404);
    agencyRespondResponses[404].parse(missingRespond.body);

    const [member] = await db
      .select({ id: agency_members.id })
      .from(agency_members)
      .where(eq(agency_members.freelancer_id, inviteeId));

    const memberTeamList = await request(app)
      .get(`${API}/team/invitations`)
      .query(q)
      .set(as(inviteeId));
    expect(memberTeamList.status).toBe(200);
    agencyTeamInvitationsResponses[200].parse(memberTeamList.body);

    const roleChanged = await request(app)
      .patch(`${API}/team/members/${member!.id}`)
      .set(as(ownerId))
      .send({ role: "freelancer", memberRole: "Agency member" });
    expect(roleChanged.status).toBe(200);
    agencyMemberMutationResponses[200].parse(roleChanged.body);

    const removed = await request(app)
      .delete(`${API}/team/members/${member!.id}`)
      .query(q)
      .set(as(ownerId));
    expect(removed.status).toBe(200);
    agencyMemberMutationResponses[200].parse(removed.body);

    const missingMember = await request(app)
      .delete(`${API}/team/members/${randomUUID()}`)
      .query(q)
      .set(as(ownerId));
    expect(missingMember.status).toBe(404);
    agencyMemberMutationResponses[404].parse(missingMember.body);

    const missingMemberRole = await request(app)
      .patch(`${API}/team/members/${randomUUID()}`)
      .set(as(ownerId))
      .send({ role: "freelancer", memberRole: "Agency member" });
    expect(missingMemberRole.status).toBe(404);
    agencyMemberMutationResponses[404].parse(missingMemberRole.body);

    const second = await request(app)
      .post(`${API}/team/invitations`)
      .set(as(ownerId))
      .send({ role: "freelancer", email: emailOf(otherId) });
    expect(second.status).toBe(201);
    const cancelled = await request(app)
      .delete(`${API}/team/invitations/${second.body.data.id}`)
      .query(q)
      .set(as(ownerId));
    expect(cancelled.status).toBe(200);
    agencyInvitationMutationResponses[200].parse(cancelled.body);

    const missingCancel = await request(app)
      .delete(`${API}/team/invitations/${randomUUID()}`)
      .query(q)
      .set(as(ownerId));
    expect(missingCancel.status).toBe(404);
    agencyInvitationMutationResponses[404].parse(missingCancel.body);

    const missingRole = await request(app)
      .patch(`${API}/team/invitations/${randomUUID()}`)
      .set(as(ownerId))
      .send({ role: "freelancer", memberRole: "Agency member" });
    expect(missingRole.status).toBe(404);
    agencyInvitationMutationResponses[404].parse(missingRole.body);

    const missingResend = await request(app)
      .post(`${API}/team/invitations/${randomUUID()}/resend`)
      .set(as(ownerId))
      .send({ role: "freelancer" });
    expect(missingResend.status).toBe(404);
    agencyResendInvitationResponses[404].parse(missingResend.body);

    const [ownerMember] = await db
      .select({ id: agency_members.id })
      .from(agency_members)
      .where(eq(agency_members.freelancer_id, ownerId));

    const ownerRole = await request(app)
      .patch(`${API}/team/members/${ownerMember!.id}`)
      .set(as(ownerId))
      .send({ role: "freelancer", memberRole: "Agency member" });
    expect(ownerRole.status).toBe(400);
    agencyMemberMutationResponses[400].parse(ownerRole.body);

    const ownerRemoval = await request(app)
      .delete(`${API}/team/members/${ownerMember!.id}`)
      .query(q)
      .set(as(ownerId));
    expect(ownerRemoval.status).toBe(400);
    agencyMemberMutationResponses[400].parse(ownerRemoval.body);

    expect(agencyId).toBeDefined();
  });

  it("answers 403 with the declared bodies", async () => {
    const { agencyId } = await seedAgency();
    const { freelancerId: plainMember } = await addMember(
      agencyId,
      "Agency member",
    );
    const clientId = await insertAccount(newAuthId(), "CLIENT");

    const denied = await request(app)
      .get(`${API}/team/invitations`)
      .query(q)
      .set(as(plainMember));
    expect(denied.status).toBe(403);
    expect(denied.body.code).toBe("AGENCY_PERMISSION_DENIED");
    agencyTeamInvitationsResponses[403].parse(denied.body);

    const notOwner = await request(app)
      .post(`${API}/team/invitations`)
      .set(as(plainMember))
      .send({ role: "freelancer", email: "someone@example.test" });
    expect(notOwner.status).toBe(403);
    agencyInviteResponses[403].parse(notOwner.body);

    const removeDenied = await request(app)
      .delete(`${API}/team/members/${randomUUID()}`)
      .query(q)
      .set(as(plainMember));
    expect(removeDenied.status).toBe(403);
    agencyMemberMutationResponses[403].parse(removeDenied.body);

    const invitationDenied = await request(app)
      .delete(`${API}/team/invitations/${randomUUID()}`)
      .query(q)
      .set(as(plainMember));
    expect(invitationDenied.status).toBe(403);
    agencyInvitationMutationResponses[403].parse(invitationDenied.body);

    const wrongRole = await request(app)
      .get(`${API}/mine`)
      .query({ role: "client" })
      .set(as(clientId));
    expect(wrongRole.status).toBe(403);
    agencyMineResponses[403].parse(wrongRole.body);

    const membershipWrongRole = await request(app)
      .get(`${API}/membership`)
      .query({ role: "client" })
      .set(as(clientId));
    expect(membershipWrongRole.status).toBe(403);
    agencyMembershipResponses[403].parse(membershipWrongRole.body);

    const verificationWrongRole = await request(app)
      .get(`${API}/verification`)
      .query({ role: "client" })
      .set(as(clientId));
    expect(verificationWrongRole.status).toBe(403);
    agencyVerificationResponses[403].parse(verificationWrongRole.body);

    const myInvitationsWrongRole = await request(app)
      .get(`${API}/invitations/mine`)
      .query({ role: "client" })
      .set(as(clientId));
    expect(myInvitationsWrongRole.status).toBe(403);
    agencyMyInvitationsResponses[403].parse(myInvitationsWrongRole.body);

    const respondWrongRole = await request(app)
      .patch(`${API}/invitations/${randomUUID()}/respond`)
      .set(as(clientId))
      .send({ role: "client", accept: true });
    expect(respondWrongRole.status).toBe(403);
    agencyRespondResponses[403].parse(respondWrongRole.body);

    const createWrongRole = await request(app)
      .post(API)
      .set(as(clientId))
      .send({
        role: "client",
        name: "x",
        size: "1-10",
        specialty: "x",
        overview: "x",
      });
    expect(createWrongRole.status).toBe(403);
    agencyCreateResponses[403].parse(createWrongRole.body);

    const updateWrongRole = await request(app).put(API).set(as(clientId)).send({
      role: "client",
      name: "x",
      professionalTitle: "x",
      size: "1-10",
      specialty: "x",
      overview: "x",
    });
    expect(updateWrongRole.status).toBe(403);
    agencyUpdateResponses[403].parse(updateWrongRole.body);
  });
});

describe("agency contract: jobs, proposals and connects", () => {
  it("serves the job feed, proposals and connects endpoints", async () => {
    const { ownerId, agencyId } = await seedAgency();
    const { jobId } = await seedClientWithJob();

    const feed = await request(app)
      .get(`${API}/jobs`)
      .query(q)
      .set(as(ownerId));
    expect(feed.status).toBe(200);
    expect(feed.body.data.length).toBeGreaterThan(0);
    expect(feed.body.data[0].matchScore).toBeGreaterThan(0);
    agencyJobFeedResponses[200].parse(feed.body);

    const recent = await request(app)
      .get(`${API}/jobs`)
      .query({ ...q, filter: "recent" })
      .set(as(ownerId));
    expect(recent.status).toBe(200);
    agencyJobFeedResponses[200].parse(recent.body);

    const lonely = await insertFreelancer();
    const noAgencyFeed = await request(app)
      .get(`${API}/jobs`)
      .query(q)
      .set(as(lonely));
    expect(noAgencyFeed.status).toBe(404);
    agencyJobFeedResponses[404].parse(noAgencyFeed.body);

    const balance = await request(app)
      .get(`${API}/connects`)
      .query(q)
      .set(as(ownerId));
    expect(balance.status).toBe(200);
    agencyConnectsResponses[200].parse(balance.body);

    const noBalance = await request(app)
      .get(`${API}/connects`)
      .query(q)
      .set(as(lonely));
    expect(noBalance.status).toBe(404);
    agencyConnectsResponses[404].parse(noBalance.body);

    const history = await request(app)
      .get(`${API}/connects/history`)
      .query(q)
      .set(as(ownerId));
    expect(history.status).toBe(200);
    expect(history.body.data).toHaveLength(1);
    agencyConnectsHistoryResponses[200].parse(history.body);

    const checkout = await request(app)
      .post(`${API}/connects/checkout`)
      .set(as(ownerId))
      .send({ role: "freelancer", connects: 20 });
    expect(checkout.status).toBe(200);
    agencyConnectsCheckoutResponses[200].parse(checkout.body);

    const { freelancerId: plainMember } = await addMember(
      agencyId,
      "Agency member",
    );
    const checkoutDenied = await request(app)
      .post(`${API}/connects/checkout`)
      .set(as(plainMember))
      .send({ role: "freelancer", connects: 20 });
    expect(checkoutDenied.status).toBe(403);
    expect(checkoutDenied.body.code).toBe("AGENCY_PERMISSION_DENIED");
    agencyConnectsCheckoutResponses[403].parse(checkoutDenied.body);

    const checkoutNoAgency = await request(app)
      .post(`${API}/connects/checkout`)
      .set(as(lonely))
      .send({ role: "freelancer", connects: 20 });
    expect(checkoutNoAgency.status).toBe(404);
    agencyConnectsCheckoutResponses[404].parse(checkoutNoAgency.body);

    const proposalBody = {
      role: "freelancer",
      jobId,
      coverLetter: "We are a strong fit for this brand design job. ".repeat(3),
      bidAmountCents: 90000,
      duration: "3 weeks",
      screeningAnswers: [],
    };
    const submitted = await request(app)
      .post(`${API}/proposals`)
      .set(as(ownerId))
      .send(proposalBody);
    expect(submitted.status).toBe(201);
    agencySubmitProposalResponses[201].parse(submitted.body);

    const duplicate = await request(app)
      .post(`${API}/proposals`)
      .set(as(ownerId))
      .send(proposalBody);
    expect(duplicate.status).toBe(409);
    agencySubmitProposalResponses[409].parse(duplicate.body);

    const missingJob = await request(app)
      .post(`${API}/proposals`)
      .set(as(ownerId))
      .send({ ...proposalBody, jobId: randomUUID() });
    expect(missingJob.status).toBe(404);
    agencySubmitProposalResponses[404].parse(missingJob.body);

    const submitDenied = await request(app)
      .post(`${API}/proposals`)
      .set(as(plainMember))
      .send(proposalBody);
    expect(submitDenied.status).toBe(403);
    agencySubmitProposalResponses[403].parse(submitDenied.body);

    const list = await request(app)
      .get(`${API}/proposals`)
      .query(q)
      .set(as(ownerId));
    expect(list.status).toBe(200);
    expect(list.body.data).toHaveLength(1);
    agencyProposalsResponses[200].parse(list.body);

    const metadata = await request(app)
      .get(`${API}/proposals/metadata`)
      .query(q)
      .set(as(ownerId));
    expect(metadata.status).toBe(200);
    expect(metadata.body.data.proposals).toHaveLength(1);
    agencyProposalMetadataResponses[200].parse(metadata.body);

    const emptyMetadata = await request(app)
      .get(`${API}/proposals/metadata`)
      .query(q)
      .set(as(lonely));
    expect(emptyMetadata.status).toBe(200);
    agencyProposalMetadataResponses[200].parse(emptyMetadata.body);

    const clientId = await insertAccount(newAuthId(), "CLIENT");
    const proposalsWrongRole = await request(app)
      .get(`${API}/proposals`)
      .query({ role: "client" })
      .set(as(clientId));
    expect(proposalsWrongRole.status).toBe(403);
    agencyProposalsResponses[403].parse(proposalsWrongRole.body);

    const feedWrongRole = await request(app)
      .get(`${API}/jobs`)
      .query({ role: "client" })
      .set(as(clientId));
    expect(feedWrongRole.status).toBe(403);
    agencyJobFeedResponses[403].parse(feedWrongRole.body);

    const connectsWrongRole = await request(app)
      .get(`${API}/connects`)
      .query({ role: "client" })
      .set(as(clientId));
    expect(connectsWrongRole.status).toBe(403);
    agencyConnectsResponses[403].parse(connectsWrongRole.body);

    const historyWrongRole = await request(app)
      .get(`${API}/connects/history`)
      .query({ role: "client" })
      .set(as(clientId));
    expect(historyWrongRole.status).toBe(403);
    agencyConnectsHistoryResponses[403].parse(historyWrongRole.body);

    const metadataWrongRole = await request(app)
      .get(`${API}/proposals/metadata`)
      .query({ role: "client" })
      .set(as(clientId));
    expect(metadataWrongRole.status).toBe(403);
    agencyProposalMetadataResponses[403].parse(metadataWrongRole.body);
  });
});

describe("agency contract: earnings and payouts", () => {
  it("serves earnings, the empty fallbacks and the payout link", async () => {
    const { ownerId, agencyId } = await seedAgency();
    await seedAgencyWork(agencyId, ownerId);

    const summary = await request(app)
      .get(`${API}/earnings/summary`)
      .query(q)
      .set(as(ownerId));
    expect(summary.status).toBe(200);
    expect(summary.body.data.hasEarnings).toBe(true);
    agencyEarningsSummaryResponses[200].parse(summary.body);

    const overview = await request(app)
      .get(`${API}/earnings/overview`)
      .query(q)
      .set(as(ownerId));
    expect(overview.status).toBe(200);
    const statuses = overview.body.data.recentEarnings.map(
      (item: { status: string }) => item.status,
    );
    expect(statuses).toContain("WITHDRAWN");
    expect(statuses).toContain("PENDING");
    agencyEarningsOverviewResponses[200].parse(overview.body);

    const lonely = await insertFreelancer();
    const emptySummary = await request(app)
      .get(`${API}/earnings/summary`)
      .query(q)
      .set(as(lonely));
    expect(emptySummary.status).toBe(200);
    expect(emptySummary.body.data).toEqual({
      hasEarnings: false,
      currentMonthTotalCents: 0,
      previousMonthTotalCents: 0,
      series: [],
    });
    agencyEarningsSummaryResponses[200].parse(emptySummary.body);

    const emptyOverview = await request(app)
      .get(`${API}/earnings/overview`)
      .query(q)
      .set(as(lonely));
    expect(emptyOverview.status).toBe(200);
    expect(emptyOverview.body.data).toEqual({
      availableCents: 0,
      pendingCents: 0,
      withdrawnCents: 0,
      lifetimeCents: 0,
      totalFeesCents: 0,
      recentEarnings: [],
    });
    agencyEarningsOverviewResponses[200].parse(emptyOverview.body);

    const { freelancerId: plainMember } = await addMember(
      agencyId,
      "Agency member",
    );
    const summaryDenied = await request(app)
      .get(`${API}/earnings/summary`)
      .query(q)
      .set(as(plainMember));
    expect(summaryDenied.status).toBe(403);
    agencyEarningsSummaryResponses[403].parse(summaryDenied.body);

    const overviewDenied = await request(app)
      .get(`${API}/earnings/overview`)
      .query(q)
      .set(as(plainMember));
    expect(overviewDenied.status).toBe(403);
    agencyEarningsOverviewResponses[403].parse(overviewDenied.body);

    const payout = await request(app)
      .get(`${API}/payouts/connect-link`)
      .query(q)
      .set(as(ownerId));
    expect(payout.status).toBe(200);
    agencyPayoutLinkResponses[200].parse(payout.body);

    const payoutDenied = await request(app)
      .get(`${API}/payouts/connect-link`)
      .query(q)
      .set(as(plainMember));
    expect(payoutDenied.status).toBe(403);
    agencyPayoutLinkResponses[403].parse(payoutDenied.body);
  });
});
