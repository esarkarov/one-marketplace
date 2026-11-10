import { createClerkClient } from "@clerk/backend";
import { and, count, desc, eq, inArray, sql, sum } from "drizzle-orm";
import { db } from "../../database/client.js";
import { redis } from "../../config/redis.js";
import { getNats } from "../../config/nats.js";
import { env } from "../../config/env.js";
import { ApiError } from "../../utils/api-error.js";
import {
  isAllowedRedisKey,
  REDIS_REDACTED_PREFIX,
  REDIS_REDACTED_VALUE,
} from "./admin-redis.js";
import {
  accounts,
  agency_metadata,
  client_metadata,
  connects,
  connects_purchase_history,
  contract_milestones,
  contracts,
  earning_history,
  job_posts,
  payout_history,
  proposals,
} from "../../database/schema.js";

export interface Pagination {
  limit: number;
  offset: number;
}

export interface PaginatedResult<T> {
  results: T[];
  hasMore: boolean;
}

const clerkNames = async (authIds: string[]) => {
  const unique = [...new Set(authIds)];
  const names = new Map<
    string,
    { name: string; avatarUrl: string | null; email: string | null }
  >();
  if (!unique.length || !env.clerkSecretKey) return names;

  const clerk = createClerkClient({ secretKey: env.clerkSecretKey });
  await Promise.all(
    unique.map(async (authId) => {
      try {
        const user = await clerk.users.getUser(authId);
        names.set(authId, {
          name:
            [user.firstName, user.lastName].filter(Boolean).join(" ") ||
            user.emailAddresses[0]?.emailAddress ||
            "Unknown",
          avatarUrl: user.imageUrl || null,
          email: user.emailAddresses[0]?.emailAddress ?? null,
        });
      } catch {
        names.set(authId, { name: "Unknown", avatarUrl: null, email: null });
      }
    }),
  );
  return names;
};

const mergePages = <T extends { createdAt: Date | null }>(
  sources: T[][],
  { limit, offset }: Pagination,
): PaginatedResult<T> => {
  const merged = sources
    .flat()
    .filter((item): item is T & { createdAt: Date } => Boolean(item.createdAt))
    .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  return {
    results: merged.slice(offset, offset + limit),
    hasMore: merged.length > offset + limit,
  };
};

export const getAdminOverviewTotals = async () => {
  const [
    [freelancerCount],
    [clientCount],
    [agencyCount],
    [jobPostCount],
    [proposalCount],
    [contractCount],
    [activeContractCount],
    [contractVolume],
    [payoutVolume],
    [connectsRevenue],
  ] = await Promise.all([
    db
      .select({ value: count() })
      .from(accounts)
      .where(eq(accounts.role, "FREELANCER")),
    db
      .select({ value: count() })
      .from(accounts)
      .where(eq(accounts.role, "CLIENT")),
    db.select({ value: count() }).from(agency_metadata),
    db.select({ value: count() }).from(job_posts),
    db.select({ value: count() }).from(proposals),
    db.select({ value: count() }).from(contracts),
    db
      .select({ value: count() })
      .from(contracts)
      .where(eq(contracts.status, "ACTIVE")),
    db.select({ value: sum(contracts.total_amount) }).from(contracts),
    db.select({ value: sum(payout_history.amount) }).from(payout_history),
    db
      .select({ value: sum(connects_purchase_history.amount_paid) })
      .from(connects_purchase_history)
      .where(eq(connects_purchase_history.status, "COMPLETED")),
  ]);

  return {
    totals: {
      freelancers: Number(freelancerCount?.value ?? 0),
      clients: Number(clientCount?.value ?? 0),
      agencies: Number(agencyCount?.value ?? 0),
      jobPosts: Number(jobPostCount?.value ?? 0),
      proposals: Number(proposalCount?.value ?? 0),
      contracts: Number(contractCount?.value ?? 0),
      activeContracts: Number(activeContractCount?.value ?? 0),
    },
    volume: {
      totalContractValue: Number(contractVolume?.value ?? 0),
      totalPaidOut: Number(payoutVolume?.value ?? 0),
      totalConnectsRevenue: Number(connectsRevenue?.value ?? 0),
    },
  };
};

export const getAdminOverviewActivity = async (pagination: Pagination) => {
  const fetchLimit = pagination.offset + pagination.limit;

  const [recentAccounts, recentAgencies, recentJobs, recentContracts] =
    await Promise.all([
      db
        .select({
          id: accounts.id,
          role: accounts.role,
          createdAt: accounts.created_at,
        })
        .from(accounts)
        .orderBy(desc(accounts.created_at))
        .limit(fetchLimit),
      db
        .select({
          id: agency_metadata.id,
          name: agency_metadata.name,
          createdAt: agency_metadata.created_at,
        })
        .from(agency_metadata)
        .orderBy(desc(agency_metadata.created_at))
        .limit(fetchLimit),
      db
        .select({
          id: job_posts.id,
          title: job_posts.title,
          createdAt: job_posts.created_at,
        })
        .from(job_posts)
        .orderBy(desc(job_posts.created_at))
        .limit(fetchLimit),
      db
        .select({
          id: contracts.id,
          title: contracts.title,
          createdAt: contracts.created_at,
        })
        .from(contracts)
        .orderBy(desc(contracts.created_at))
        .limit(fetchLimit),
    ]);

  return mergePages(
    [
      recentAccounts.map((row) => ({
        type: row.role === "FREELANCER" ? "Freelancer joined" : "Client joined",
        id: row.id,
        title:
          row.role === "FREELANCER"
            ? "New freelancer account"
            : "New client account",
        createdAt: row.createdAt,
      })),
      recentAgencies.map((row) => ({
        type: "Agency created",
        id: row.id,
        title: row.name,
        createdAt: row.createdAt,
      })),
      recentJobs.map((row) => ({
        type: "Job posted",
        id: row.id,
        title: row.title,
        createdAt: row.createdAt,
      })),
      recentContracts.map((row) => ({
        type: "Contract created",
        id: row.id,
        title: row.title,
        createdAt: row.createdAt,
      })),
    ],
    pagination,
  );
};

export const getAdminAccounts = async (pagination: Pagination) => {
  const fetchLimit = pagination.offset + pagination.limit;

  const [personalRows, agencyRows] = await Promise.all([
    db
      .select({
        authId: accounts.auth_id,
        role: accounts.role,
        email: accounts.email,
        identityVerified: accounts.identityVerified,
        paymentMethodVerified: accounts.paymentMethodVerified,
        isOnboardingComplete: accounts.isOnboardingComplete,
        createdAt: accounts.created_at,
        companyName: client_metadata.company_name,
      })
      .from(accounts)
      .leftJoin(client_metadata, eq(client_metadata.auth_id, accounts.auth_id))
      .orderBy(desc(accounts.created_at))
      .limit(fetchLimit),
    db
      .select({
        id: agency_metadata.id,
        name: agency_metadata.name,
        avatarImage: agency_metadata.avatar_image,
        ownerId: agency_metadata.owner_id,
        isOnboarded: agency_metadata.is_onboarded,
        createdAt: agency_metadata.created_at,
        ownerEmail: accounts.email,
        ownerIdentityVerified: accounts.identityVerified,
      })
      .from(agency_metadata)
      .innerJoin(accounts, eq(accounts.auth_id, agency_metadata.owner_id))
      .orderBy(desc(agency_metadata.created_at))
      .limit(fetchLimit),
  ]);

  const names = await clerkNames(personalRows.map((row) => row.authId));

  const people = personalRows.map((row) => ({
    id: row.authId,
    type: row.role === "FREELANCER" ? "Freelancer" : "Client",
    name:
      row.role === "CLIENT" && row.companyName
        ? row.companyName
        : (names.get(row.authId)?.name ?? row.email),
    avatarUrl: names.get(row.authId)?.avatarUrl ?? null,
    email: row.email,
    verified: row.identityVerified === true,
    paymentVerified: row.paymentMethodVerified === true,
    onboarded: row.isOnboardingComplete === true,
    createdAt: row.createdAt,
  }));

  const agencies = agencyRows.map((row) => ({
    id: row.id,
    type: "Agency" as const,
    name: row.name,
    avatarUrl: row.avatarImage?.url ?? null,
    email: row.ownerEmail,
    verified: row.ownerIdentityVerified === true,
    paymentVerified: false,
    onboarded: row.isOnboarded === true,
    createdAt: row.createdAt,
  }));

  return mergePages([people, agencies], pagination);
};

export const getAdminJobPosts = async ({ limit, offset }: Pagination) => {
  const rows = await db
    .select({
      id: job_posts.id,
      title: job_posts.title,
      description: job_posts.description,
      status: job_posts.status,
      totalBudget: job_posts.total_budget,
      expertiseLevel: job_posts.expertise_level,
      expectedDuration: job_posts.expected_duration,
      skills: job_posts.skills,
      milestones: job_posts.milestones,
      screeningQuestions: job_posts.screening_questions,
      attachments: job_posts.attachments,
      clientId: job_posts.client_id,
      companyName: client_metadata.company_name,
      companyWebsite: client_metadata.company_website,
      industry: client_metadata.industry,
      companyDescription: client_metadata.company_description,
      clientEmail: accounts.email,
      createdAt: job_posts.created_at,
      updatedAt: job_posts.updated_at,
      publishedAt: job_posts.published_at,
      hiredAt: job_posts.hired_at,
      proposalCount: sql<number>`(
        SELECT count(*) FROM ${proposals} WHERE ${proposals.job_id} = ${job_posts.id}
      )`.mapWith(Number),
      hireCount: sql<number>`(
        SELECT count(*) FROM ${contracts}
        WHERE ${contracts.job_id} = ${job_posts.id}
          AND ${contracts.status} IN ('ACTIVE', 'COMPLETED')
      )`.mapWith(Number),
    })
    .from(job_posts)
    .leftJoin(client_metadata, eq(client_metadata.auth_id, job_posts.client_id))
    .leftJoin(accounts, eq(accounts.auth_id, job_posts.client_id))
    .orderBy(desc(job_posts.created_at))
    .limit(limit)
    .offset(offset);

  return {
    results: rows.map((row) => ({
      ...row,
      totalBudget: Number(row.totalBudget),
      clientName: row.companyName ?? "Unknown client",
    })),
    hasMore: rows.length === limit,
  };
};

export const getAdminProposals = async ({ limit, offset }: Pagination) => {
  const rows = await db
    .select({
      id: proposals.id,
      jobId: proposals.job_id,
      jobTitle: job_posts.title,
      jobBudget: job_posts.total_budget,
      jobStatus: job_posts.status,
      senderId: proposals.sender_id,
      senderType: proposals.sender_type,
      coverLetter: proposals.cover_letter,
      bidAmount: proposals.bid_amount,
      duration: proposals.duration,
      screeningAnswers: proposals.screening_answers,
      status: proposals.status,
      isShortlisted: proposals.is_shortlisted,
      createdAt: proposals.created_at,
      updatedAt: proposals.updated_at,
      agencyName: agency_metadata.name,
      agencySpecialty: agency_metadata.specialty,
      agencyWebsite: agency_metadata.website,
    })
    .from(proposals)
    .innerJoin(job_posts, eq(job_posts.id, proposals.job_id))
    .leftJoin(
      agency_metadata,
      and(
        eq(proposals.sender_type, "AGENCY"),
        sql`${proposals.sender_id} = ${agency_metadata.id}::text`,
      ),
    )
    .orderBy(desc(proposals.created_at))
    .limit(limit)
    .offset(offset);

  const freelancerIds = rows
    .filter((row) => row.senderType === "FREELANCER")
    .map((row) => row.senderId);
  const names = await clerkNames(freelancerIds);

  const results = rows.map((row) => {
    const freelancer = names.get(row.senderId);
    return {
      id: row.id,
      jobId: row.jobId,
      jobTitle: row.jobTitle,
      jobBudget: Number(row.jobBudget),
      jobStatus: row.jobStatus,
      senderId: row.senderId,
      senderType: row.senderType,
      senderName:
        row.senderType === "AGENCY"
          ? (row.agencyName ?? "Unknown agency")
          : (freelancer?.name ?? "Unknown freelancer"),
      senderAvatarUrl:
        row.senderType === "AGENCY" ? null : (freelancer?.avatarUrl ?? null),
      senderEmail:
        row.senderType === "AGENCY" ? null : (freelancer?.email ?? null),
      agencySpecialty: row.senderType === "AGENCY" ? row.agencySpecialty : null,
      agencyWebsite: row.senderType === "AGENCY" ? row.agencyWebsite : null,
      coverLetter: row.coverLetter,
      bidAmount: Number(row.bidAmount),
      duration: row.duration,
      screeningAnswers: row.screeningAnswers,
      status: row.status,
      isShortlisted: row.isShortlisted,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  });

  return { results, hasMore: rows.length === limit };
};

export const getAdminContracts = async ({ limit, offset }: Pagination) => {
  const rows = await db
    .select({
      id: contracts.id,
      title: contracts.title,
      status: contracts.status,
      totalAmount: contracts.total_amount,
      jobId: contracts.job_id,
      proposalId: contracts.proposal_id,
      clientId: contracts.client_id,
      freelancerId: contracts.freelancer_id,
      agencyId: contracts.agency_id,
      companyName: client_metadata.company_name,
      clientEmail: accounts.email,
      agencyName: agency_metadata.name,
      agencySpecialty: agency_metadata.specialty,
      agencyWebsite: agency_metadata.website,
      createdAt: contracts.created_at,
      updatedAt: contracts.updated_at,
      startedAt: contracts.started_at,
      completedAt: contracts.completed_at,
    })
    .from(contracts)
    .leftJoin(client_metadata, eq(client_metadata.auth_id, contracts.client_id))
    .leftJoin(accounts, eq(accounts.auth_id, contracts.client_id))
    .leftJoin(agency_metadata, eq(agency_metadata.id, contracts.agency_id))
    .orderBy(desc(contracts.created_at))
    .limit(limit)
    .offset(offset);

  const freelancerIds = rows
    .map((row) => row.freelancerId)
    .filter((id): id is string => Boolean(id));
  const names = await clerkNames(freelancerIds);

  const milestoneRows = rows.length
    ? await db
        .select({
          id: contract_milestones.id,
          contractId: contract_milestones.contract_id,
          title: contract_milestones.title,
          amount: contract_milestones.amount,
          dueDate: contract_milestones.due_date,
          position: contract_milestones.position,
          status: contract_milestones.status,
          fundedAt: contract_milestones.funded_at,
          submissionMessage: contract_milestones.submission_message,
          submissionDeliveryLink: contract_milestones.submission_delivery_link,
          completedAt: contract_milestones.completed_at,
        })
        .from(contract_milestones)
        .where(
          inArray(
            contract_milestones.contract_id,
            rows.map((row) => row.id),
          ),
        )
        .orderBy(contract_milestones.position)
    : [];

  const results = rows.map((row) => {
    const freelancer = row.freelancerId
      ? names.get(row.freelancerId)
      : undefined;
    return {
      id: row.id,
      title: row.title,
      status: row.status,
      totalAmount: Number(row.totalAmount),
      jobId: row.jobId,
      proposalId: row.proposalId,
      clientId: row.clientId,
      clientName: row.companyName ?? "Unknown client",
      clientEmail: row.clientEmail,
      talentId: row.agencyId ?? row.freelancerId,
      talentName:
        row.agencyName ??
        (row.freelancerId
          ? (freelancer?.name ?? "Unknown freelancer")
          : "Unknown"),
      talentAvatarUrl: row.agencyId ? null : (freelancer?.avatarUrl ?? null),
      talentEmail: row.agencyId ? null : (freelancer?.email ?? null),
      agencySpecialty: row.agencyId ? row.agencySpecialty : null,
      agencyWebsite: row.agencyId ? row.agencyWebsite : null,
      talentKind: row.agencyId ? "Agency" : "Freelancer",
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
      startedAt: row.startedAt,
      completedAt: row.completedAt,
      milestones: milestoneRows
        .filter((milestone) => milestone.contractId === row.id)
        .map((milestone) => ({
          ...milestone,
          amount: Number(milestone.amount),
        })),
    };
  });

  return { results, hasMore: rows.length === limit };
};

type AdminTransactionRow =
  | {
      id: string;
      type: "MILESTONE_FUNDED";
      description: string;
      party: string;
      amount: number;
      createdAt: Date | null;
    }
  | {
      id: string;
      type: "EARNING";
      description: string;
      party: string;
      amount: number;
      createdAt: Date | null;
    }
  | {
      id: string;
      type: "PAYOUT";
      description: string;
      party: string;
      amount: number;
      createdAt: Date | null;
    }
  | {
      id: string;
      type: "CONNECTS_PURCHASE";
      description: string;
      party: string;
      amount: number;
      createdAt: Date | null;
    };

export const getAdminTransactions = async (pagination: Pagination) => {
  const fetchLimit = pagination.offset + pagination.limit;

  const [funded, earned, paidOut, connectsPurchases] = await Promise.all([
    db
      .select({
        id: contract_milestones.id,
        contractId: contract_milestones.contract_id,
        title: contract_milestones.title,
        amount: contract_milestones.amount,
        createdAt: contract_milestones.funded_at,
      })
      .from(contract_milestones)
      .where(sql`${contract_milestones.funded_at} IS NOT NULL`)
      .orderBy(desc(contract_milestones.funded_at))
      .limit(fetchLimit),
    db
      .select({
        id: earning_history.id,
        contractId: earning_history.contract_id,
        description: earning_history.description,
        amount: earning_history.amount,
        freelancerId: earning_history.freelancer_id,
        agencyId: earning_history.agency_id,
        createdAt: earning_history.created_at,
      })
      .from(earning_history)
      .orderBy(desc(earning_history.created_at))
      .limit(fetchLimit),
    db
      .select({
        id: payout_history.id,
        amount: payout_history.amount,
        freelancerId: payout_history.freelancer_id,
        agencyId: payout_history.agency_id,
        createdAt: payout_history.created_at,
      })
      .from(payout_history)
      .orderBy(desc(payout_history.created_at))
      .limit(fetchLimit),
    db
      .select({
        id: connects_purchase_history.id,
        purchasedConnects: connects_purchase_history.purchased_connects,
        amountPaid: connects_purchase_history.amount_paid,
        status: connects_purchase_history.status,
        freelancerId: connects.freelancer_id,
        agencyId: connects.agency_id,
        createdAt: connects_purchase_history.created_at,
      })
      .from(connects_purchase_history)
      .innerJoin(
        connects,
        eq(connects.id, connects_purchase_history.connects_id),
      )
      .orderBy(desc(connects_purchase_history.created_at))
      .limit(fetchLimit),
  ]);

  const agencyIds = [
    ...earned.map((row) => row.agencyId),
    ...paidOut.map((row) => row.agencyId),
    ...connectsPurchases.map((row) => row.agencyId),
  ].filter((id): id is string => Boolean(id));
  const freelancerIds = [
    ...earned.map((row) => row.freelancerId),
    ...paidOut.map((row) => row.freelancerId),
    ...connectsPurchases.map((row) => row.freelancerId),
  ].filter((id): id is string => Boolean(id));

  const [agencyNames, names] = await Promise.all([
    agencyIds.length
      ? db
          .select({ id: agency_metadata.id, name: agency_metadata.name })
          .from(agency_metadata)
          .where(inArray(agency_metadata.id, [...new Set(agencyIds)]))
      : Promise.resolve([]),
    clerkNames(freelancerIds),
  ]);
  const agencyNameById = new Map(agencyNames.map((row) => [row.id, row.name]));

  const partyName = (freelancerId: string | null, agencyId: string | null) =>
    agencyId
      ? (agencyNameById.get(agencyId) ?? "Unknown agency")
      : freelancerId
        ? (names.get(freelancerId)?.name ?? "Unknown freelancer")
        : "Unknown";

  return mergePages<AdminTransactionRow>(
    [
      funded.map((row) => ({
        id: row.id,
        type: "MILESTONE_FUNDED" as const,
        description: row.title,
        party: "Client escrow",
        amount: Number(row.amount),
        createdAt: row.createdAt,
      })),
      earned.map((row) => ({
        id: row.id,
        type: "EARNING" as const,
        description: row.description,
        party: partyName(row.freelancerId, row.agencyId),
        amount: Number(row.amount),
        createdAt: row.createdAt,
      })),
      paidOut.map((row) => ({
        id: row.id,
        type: "PAYOUT" as const,
        description: "Stripe payout",
        party: partyName(row.freelancerId, row.agencyId),
        amount: Number(row.amount),
        createdAt: row.createdAt,
      })),
      connectsPurchases.map((row) => ({
        id: row.id,
        type: "CONNECTS_PURCHASE" as const,
        description: `${row.purchasedConnects} Connects (${row.status})`,
        party: partyName(row.freelancerId, row.agencyId),
        amount: Number(row.amountPaid),
        createdAt: row.createdAt,
      })),
    ],
    pagination,
  );
};

export const getSystemHealth = async () => {
  const startedAt = Date.now();

  const [redisResult, dbResult, natsResult] = await Promise.allSettled([
    (async () => {
      const start = Date.now();
      await redis.ping();
      return { ok: true, latencyMs: Date.now() - start };
    })(),
    (async () => {
      const start = Date.now();
      await db.execute(sql`SELECT 1`);
      return { ok: true, latencyMs: Date.now() - start };
    })(),
    (async () => {
      const start = Date.now();
      const nc = await getNats();
      const latencyMs = await nc.rtt();
      return {
        ok: !nc.isClosed(),
        latencyMs: latencyMs ?? Date.now() - start,
        server: nc.getServer(),
      };
    })(),
  ]);

  const settle = <T>(result: PromiseSettledResult<T>) =>
    result.status === "fulfilled"
      ? { ok: true as const, ...result.value }
      : { ok: false as const, error: String(result.reason) };

  return {
    redis: settle(redisResult),
    database: settle(dbResult),
    nats: settle(natsResult),
    process: {
      uptimeSeconds: Math.round(process.uptime()),
      memory: process.memoryUsage(),
      loadAverage: (await import("os")).loadavg(),
      cpuCount: (await import("os")).cpus().length,
      totalMemoryMb: Math.round((await import("os")).totalmem() / 1024 / 1024),
      freeMemoryMb: Math.round((await import("os")).freemem() / 1024 / 1024),
      nodeVersion: process.version,
    },
    checkedAt: new Date(startedAt).toISOString(),
  };
};

const MAX_SCAN_KEYS = 200;

export const scanRedisKeys = async (pattern: string) => {
  if (!isAllowedRedisKey(pattern)) {
    throw new ApiError(400, "Invalid request.");
  }
  const keys: string[] = [];
  let cursor = "0";
  do {
    const result = await redis.scan(cursor, { MATCH: pattern, COUNT: 100 });
    cursor = result.cursor;
    keys.push(...result.keys.filter(isAllowedRedisKey));
  } while (cursor !== "0" && keys.length < MAX_SCAN_KEYS);

  const preview = keys.slice(0, MAX_SCAN_KEYS);
  const details = await Promise.all(
    preview.map(async (key) => {
      const [type, ttl] = await Promise.all([redis.type(key), redis.ttl(key)]);
      return { key, type, ttl };
    }),
  );

  return { keys: details, truncated: keys.length >= MAX_SCAN_KEYS };
};

const MAX_VALUE_PREVIEW = 5_000;

export const getRedisKeyValue = async (key: string) => {
  if (!isAllowedRedisKey(key)) {
    throw new ApiError(403, "Access to this Redis key is not allowed.");
  }
  const type = await redis.type(key);
  let value: unknown;

  switch (type) {
    case "string":
      value = await redis.get(key);
      break;
    case "hash":
      value = await redis.hGetAll(key);
      break;
    case "list":
      value = await redis.lRange(key, 0, 100);
      break;
    case "set":
      value = await redis.sMembers(key);
      break;
    case "zset":
      value = await redis.zRangeWithScores(key, 0, 100);
      break;
    case "none":
      return { type, ttl: -2, value: null };
    default:
      value = `<unsupported type: ${type}>`;
  }

  if (key.startsWith(REDIS_REDACTED_PREFIX)) {
    value = REDIS_REDACTED_VALUE;
  }

  const serialized = JSON.stringify(value);
  const truncated = serialized.length > MAX_VALUE_PREVIEW;
  const ttl = await redis.ttl(key);

  return {
    type,
    ttl,
    value: truncated ? serialized.slice(0, MAX_VALUE_PREVIEW) : value,
    truncated,
  };
};
