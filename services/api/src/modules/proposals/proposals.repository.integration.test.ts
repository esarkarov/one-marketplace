import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db, pool } from "../../database/client.js";
import {
  accounts,
  agency_earning,
  agency_members,
  agency_metadata,
  client_metadata,
  contracts,
  freelancer_earning,
  freelancer_metadata,
  job_posts,
  proposals,
} from "../../test/support/tables.js";
import { assertTestDatabase } from "../../test/setup/assert-test-database.js";
import {
  countAgencyMembers,
  findAgencyName,
  findAgencyOwnerLocation,
  findClientProposalForInterview,
  findClientProposalForView,
  findPublishedJobForProposal,
  listAgencyProposals,
  listClientJobProposalRows,
  listFreelancerProposals,
  listProposalStatusesBySender,
  markProposalInterviewedIfOpen,
  markProposalShortlistedForClient,
  markProposalViewedIfSubmitted,
} from "./proposals.repository.js";

const PREFIX = "proposals-repo-";
const like = `${PREFIX}%`;

const purge = async () => {
  await pool.query("delete from contracts where client_id like $1", [like]);
  await pool.query("delete from proposals where sender_id like $1", [like]);
  await pool.query(
    "delete from proposals where job_id in (select id from job_posts where client_id like $1)",
    [like],
  );
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

beforeAll(async () => {
  assertTestDatabase(process.env.DATABASE_URL, process.env.POSTGRES_DB);
  await purge();
});

afterAll(async () => {
  await purge();
  await pool.end();
});

const seedProposal = async (status: "SUBMITTED" | "INTERVIEWED") => {
  const clientId = `${PREFIX}${randomUUID()}`;
  await db.insert(accounts).values({
    auth_id: clientId,
    email: `${clientId}@example.test`,
    role: "CLIENT",
  });
  const [job] = await db
    .insert(job_posts)
    .values({
      client_id: clientId,
      title: "Proposal repository job",
      description: "Proposal repository job",
      expertise_level: "INTERMEDIATE",
      expected_duration: "1 week",
      total_budget_cents: 1000,
      milestones: [],
    })
    .returning({ id: job_posts.id });
  const [proposal] = await db
    .insert(proposals)
    .values({
      job_id: job!.id,
      sender_id: `${PREFIX}${randomUUID()}`,
      sender_type: "FREELANCER",
      cover_letter: "proposal repository",
      bid_amount_cents: 1000,
      duration: "1 week",
      status,
    })
    .returning({ id: proposals.id });
  return proposal!.id;
};

const statusOf = async (proposalId: string) =>
  (await db.select().from(proposals).where(eq(proposals.id, proposalId)))[0]!
    .status;

describe("proposals repository guards", () => {
  it("marks a proposal viewed only while it is SUBMITTED", async () => {
    const interviewed = await seedProposal("INTERVIEWED");
    expect(
      await markProposalViewedIfSubmitted(db, interviewed),
    ).toBeUndefined();
    expect(await statusOf(interviewed)).toBe("INTERVIEWED");

    const submitted = await seedProposal("SUBMITTED");
    expect(await markProposalViewedIfSubmitted(db, submitted)).toBeDefined();
    expect(await statusOf(submitted)).toBe("VIEWED");
  });
});

const at = (day: number) => new Date(Date.UTC(2001, 0, day));
const id = () => `${PREFIX}${randomUUID()}`;

const makeAccount = async (role: "CLIENT" | "FREELANCER") => {
  const authId = id();
  await db.insert(accounts).values({
    auth_id: authId,
    email: `${authId}@example.test`,
    role,
  });
  return authId;
};

const makeClient = async (companyName?: string) => {
  const authId = await makeAccount("CLIENT");
  if (companyName) {
    await db.insert(client_metadata).values({
      auth_id: authId,
      role: "CLIENT",
      company_name: companyName,
      company_website: "https://client.example.test",
      company_size: "1-10",
      industry: "Software",
      company_description: "repository test client",
    });
  }
  return authId;
};

const makeJob = async (
  clientId: string,
  status: "PUBLISHED" | "DRAFT" = "PUBLISHED",
  title = "Repository job",
) => {
  const [job] = await db
    .insert(job_posts)
    .values({
      client_id: clientId,
      title,
      description: "Repository job",
      expertise_level: "INTERMEDIATE",
      expected_duration: "1 week",
      total_budget_cents: 1000,
      milestones: [],
      status,
    })
    .returning({ id: job_posts.id });
  return job!.id;
};

const makeFreelancer = async (city = "Austin", country = "US") => {
  const authId = await makeAccount("FREELANCER");
  await db.insert(freelancer_metadata).values({
    auth_id: authId,
    professional_title: "Developer",
    professional_description: "desc",
    hourly_rate_cents: 5000,
    country,
    city,
    weekly_availability: "30",
    experience_level: "EXPERT",
    skills: ["node"],
    languages: [{ language: "English", proficiency: "Fluent" }],
  });
  return authId;
};

const makeAgency = async (name: string, city?: string, country?: string) => {
  const ownerId = city
    ? await makeFreelancer(city, country)
    : await makeAccount("FREELANCER");
  const [agency] = await db
    .insert(agency_metadata)
    .values({
      owner_id: ownerId,
      name,
      size: "1-10",
      specialty: "testing",
      overview: "repository test agency",
    })
    .returning({ id: agency_metadata.id });
  return agency!.id;
};

const makeProposal = async (
  jobId: string,
  senderId: string,
  options: {
    senderType?: "FREELANCER" | "AGENCY";
    status?: string;
    createdAt?: Date;
  } = {},
) => {
  const createdAt = options.createdAt ?? at(1);
  const [proposal] = await db
    .insert(proposals)
    .values({
      job_id: jobId,
      sender_id: senderId,
      sender_type: options.senderType ?? "FREELANCER",
      cover_letter: "repository proposal",
      bid_amount_cents: 1000,
      duration: "1 week",
      status: options.status ?? "SUBMITTED",
      created_at: createdAt,
      updated_at: createdAt,
    })
    .returning({ id: proposals.id });
  return proposal!.id;
};

const makeContract = async (input: {
  proposalId: string;
  jobId: string;
  clientId: string;
  freelancerId?: string;
  agencyId?: string;
}) => {
  const [contract] = await db
    .insert(contracts)
    .values({
      proposal_id: input.proposalId,
      job_id: input.jobId,
      client_id: input.clientId,
      freelancer_id: input.freelancerId ?? null,
      agency_id: input.agencyId ?? null,
      title: "Repository contract",
      total_amount_cents: 1000,
    })
    .returning({ id: contracts.id });
  return contract!.id;
};

const proposalRow = async (proposalId: string) =>
  (await db.select().from(proposals).where(eq(proposals.id, proposalId)))[0]!;

describe("proposals repository lookups", () => {
  it("finds only a published job by its id", async () => {
    const clientId = await makeClient();
    const draft = await makeJob(clientId, "DRAFT");
    const published = await makeJob(clientId, "PUBLISHED", "Published job");

    expect(await findPublishedJobForProposal(db, draft)).toBeUndefined();
    expect(await findPublishedJobForProposal(db, published)).toMatchObject({
      id: published,
      title: "Published job",
      clientId,
    });
  });

  it("finds the named agency, not another one", async () => {
    const first = await makeAgency("Repository agency one");
    const second = await makeAgency("Repository agency two");

    expect(await findAgencyName(db, second)).toEqual({
      name: "Repository agency two",
    });
    expect(await findAgencyName(db, first)).toEqual({
      name: "Repository agency one",
    });
  });

  it("counts the members of the given agency only", async () => {
    const crowded = await makeAgency("Repository crowded agency");
    const quiet = await makeAgency("Repository quiet agency");
    for (const agencyId of [crowded, crowded, quiet]) {
      await db.insert(agency_members).values({
        agency_id: agencyId,
        freelancer_id: await makeAccount("FREELANCER"),
        role: "Agency member",
      });
    }

    expect(await countAgencyMembers(db, crowded)).toEqual({ count: 2 });
    expect(await countAgencyMembers(db, quiet)).toEqual({ count: 1 });
  });

  it("reads the location of the given agency owner", async () => {
    const austin = await makeAgency("Repository austin agency", "Austin", "US");
    const lyon = await makeAgency("Repository lyon agency", "Lyon", "FR");

    expect(await findAgencyOwnerLocation(db, lyon)).toEqual({
      city: "Lyon",
      country: "FR",
    });
    expect(await findAgencyOwnerLocation(db, austin)).toEqual({
      city: "Austin",
      country: "US",
    });
  });

  it("looks a proposal up for its own client only", async () => {
    const owner = await makeClient();
    const stranger = await makeClient();
    const job = await makeJob(owner, "PUBLISHED", "Owned job");
    const proposalId = await makeProposal(job, id());
    const otherProposalId = await makeProposal(job, id());

    expect(
      await findClientProposalForView(db, proposalId, owner),
    ).toMatchObject({ id: proposalId, jobTitle: "Owned job" });
    expect(
      await findClientProposalForView(db, proposalId, stranger),
    ).toBeUndefined();
    expect(
      (await findClientProposalForView(db, otherProposalId, owner))?.id,
    ).toBe(otherProposalId);

    expect(
      await findClientProposalForInterview(db, proposalId, owner),
    ).toMatchObject({ id: proposalId, jobId: job, jobTitle: "Owned job" });
    expect(
      await findClientProposalForInterview(db, proposalId, stranger),
    ).toBeUndefined();
    expect(
      (await findClientProposalForInterview(db, otherProposalId, owner))?.id,
    ).toBe(otherProposalId);
  });
});

describe("proposals repository sender lists", () => {
  it("lists a sender's statuses of its own type, newest first", async () => {
    const clientId = await makeClient();
    const sender = id();
    const j1 = await makeJob(clientId);
    const j2 = await makeJob(clientId);
    const j3 = await makeJob(clientId);
    await makeProposal(j1, sender, { createdAt: at(1) });
    await makeProposal(j2, sender, { createdAt: at(3) });
    await makeProposal(j3, sender, { senderType: "AGENCY", createdAt: at(2) });

    const rows = await listProposalStatusesBySender(db, sender, "FREELANCER");

    expect(rows.map((row) => row.jobId)).toEqual([j2, j1]);
  });

  it("lists a freelancer's proposals newest first, with or without a client profile", async () => {
    const profiled = await makeClient("Acme Repository");
    const bare = await makeClient();
    const sender = id();
    const jp = await makeJob(profiled);
    const jb = await makeJob(bare);
    const jo = await makeJob(profiled);
    const oldest = await makeProposal(jp, sender, { createdAt: at(1) });
    const newest = await makeProposal(jb, sender, { createdAt: at(3) });
    await makeProposal(jo, sender, { senderType: "AGENCY", createdAt: at(2) });

    const rows = await listFreelancerProposals(db, sender);

    expect(rows.map((row) => row.id)).toEqual([newest, oldest]);
    expect(rows.map((row) => row.company)).toEqual([null, "Acme Repository"]);
  });

  it("lists an agency's proposals newest first and only its own type", async () => {
    const clientId = await makeClient("Agency client");
    const agencyId = await makeAgency("Repository listing agency");
    const j1 = await makeJob(clientId);
    const j2 = await makeJob(clientId);
    const j3 = await makeJob(clientId);
    const oldest = await makeProposal(j1, agencyId, {
      senderType: "AGENCY",
      createdAt: at(1),
    });
    const newest = await makeProposal(j2, agencyId, {
      senderType: "AGENCY",
      createdAt: at(3),
    });
    await makeProposal(j3, agencyId, {
      senderType: "FREELANCER",
      createdAt: at(2),
    });

    const rows = await listAgencyProposals(db, agencyId);

    expect(rows.map((row) => row.id)).toEqual([newest, oldest]);
  });

  it("lists a job's proposals for its own client with contracts and agency names", async () => {
    const owner = await makeClient();
    const stranger = await makeClient();
    const jobA1 = await makeJob(owner);
    const jobA2 = await makeJob(owner);
    const jobB = await makeJob(stranger);
    const freelancer = await makeFreelancer();
    const agencyOne = await makeAgency("Repository rows agency one");
    const agencyTwo = await makeAgency("Repository rows agency two");
    for (const agencyId of [agencyOne, agencyTwo]) {
      await db.insert(agency_earning).values({ agency_id: agencyId });
    }
    await db.insert(freelancer_earning).values({ freelancer_id: freelancer });

    const byFreelancer = await makeProposal(jobA1, freelancer, {
      createdAt: at(1),
    });
    const byAgencyTwo = await makeProposal(jobA1, agencyTwo, {
      senderType: "AGENCY",
      createdAt: at(2),
    });
    const byAgencyOne = await makeProposal(jobA1, agencyOne, {
      senderType: "AGENCY",
      createdAt: at(3),
    });
    await makeProposal(jobA2, id(), { createdAt: at(4) });
    await makeProposal(jobB, id(), { createdAt: at(5) });
    const freelancerContract = await makeContract({
      proposalId: byFreelancer,
      jobId: jobA1,
      clientId: owner,
      freelancerId: freelancer,
    });
    const agencyContract = await makeContract({
      proposalId: byAgencyOne,
      jobId: jobA1,
      clientId: owner,
      agencyId: agencyOne,
    });

    const rows = await listClientJobProposalRows(db, owner, jobA1);

    expect(rows.map((row) => row.id)).toEqual([
      byAgencyOne,
      byAgencyTwo,
      byFreelancer,
    ]);
    const row = (proposalId: string) =>
      rows.find((candidate) => candidate.id === proposalId)!;
    expect(row(byFreelancer).contractId).toBe(freelancerContract);
    expect(row(byAgencyOne).contractId).toBe(agencyContract);
    expect(row(byAgencyTwo).contractId).toBeNull();
    expect(row(byAgencyOne).agencyName).toBe("Repository rows agency one");
    expect(row(byAgencyTwo).agencyName).toBe("Repository rows agency two");
    expect(row(byFreelancer).agencyName).toBeNull();
    expect(row(byFreelancer).freelancerId).not.toBeNull();
    expect(await listClientJobProposalRows(db, stranger, jobA1)).toEqual([]);
    expect(await listClientJobProposalRows(db, owner, jobB)).toEqual([]);
  });
});

describe("proposals repository state writes", () => {
  it("marks only the given SUBMITTED proposal viewed and stamps updated_at", async () => {
    const clientId = await makeClient();
    const job = await makeJob(clientId);
    const target = await makeProposal(job, id());
    const bystander = await makeProposal(job, id());

    const updated = await markProposalViewedIfSubmitted(db, target);

    expect(updated?.id).toBe(target);
    expect((await proposalRow(target)).status).toBe("VIEWED");
    expect((await proposalRow(target)).updated_at!.getTime()).toBeGreaterThan(
      at(1).getTime(),
    );
    expect((await proposalRow(bystander)).status).toBe("SUBMITTED");
    expect((await proposalRow(bystander)).updated_at!.getTime()).toBe(
      at(1).getTime(),
    );
  });

  it("shortlists only the given proposal of the requesting client", async () => {
    const owner = await makeClient();
    const stranger = await makeClient();
    const ownerJob = await makeJob(owner);
    const strangerJob = await makeJob(stranger);
    const target = await makeProposal(ownerJob, id());
    const sibling = await makeProposal(ownerJob, id());
    const foreign = await makeProposal(strangerJob, id());

    expect(
      await markProposalShortlistedForClient(db, target, stranger),
    ).toBeUndefined();
    expect((await proposalRow(target)).is_shortlisted).toBe(false);

    expect(await markProposalShortlistedForClient(db, target, owner)).toEqual({
      id: target,
      isShortlisted: true,
    });

    expect((await proposalRow(target)).is_shortlisted).toBe(true);
    expect((await proposalRow(target)).updated_at!.getTime()).toBeGreaterThan(
      at(1).getTime(),
    );
    expect((await proposalRow(sibling)).is_shortlisted).toBe(false);
    expect((await proposalRow(foreign)).is_shortlisted).toBe(false);
  });

  it("marks a SUBMITTED or VIEWED proposal interviewed and leaves other states alone", async () => {
    const clientId = await makeClient();
    const job = await makeJob(clientId);
    const submitted = await makeProposal(job, id());
    const viewed = await makeProposal(job, id(), { status: "VIEWED" });
    const interviewed = await makeProposal(job, id(), {
      status: "INTERVIEWED",
    });

    expect(
      await markProposalInterviewedIfOpen(db, interviewed),
    ).toBeUndefined();
    expect(await markProposalInterviewedIfOpen(db, submitted)).toEqual({
      id: submitted,
    });
    expect(await markProposalInterviewedIfOpen(db, viewed)).toEqual({
      id: viewed,
    });

    for (const proposalId of [submitted, viewed]) {
      const row = await proposalRow(proposalId);
      expect(row.status).toBe("INTERVIEWED");
      expect(row.updated_at!.getTime()).toBeGreaterThan(at(1).getTime());
    }
    expect((await proposalRow(interviewed)).updated_at!.getTime()).toBe(
      at(1).getTime(),
    );
  });
});
