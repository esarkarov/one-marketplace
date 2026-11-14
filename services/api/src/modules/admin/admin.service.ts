import { clerk } from "../../infrastructure/clerk.js";
import { db } from "../../database/client.js";
import { toSafeCents } from "../../shared/money/money.js";
import { redis } from "../../infrastructure/redis.js";
import { getRabbitStatus } from "../../infrastructure/rabbitmq.js";
import { env } from "../../config/env.js";
import { logger } from "../../config/logger.js";
import { errorLogAttributes } from "../../shared/logging/sanitize-log.js";
import { ApiError } from "../../shared/http/api-error.js";
import {
  isAllowedRedisKey,
  REDIS_REDACTED_PREFIX,
  REDIS_REDACTED_VALUE,
} from "./admin-redis.js";
import {
  countAccountsByRole,
  countActiveContracts,
  countAgencies,
  countContracts,
  countJobPosts,
  countProposals,
  listAccountsWithCompany,
  listAgenciesWithOwner,
  listAgencyNamesByIds,
  listConnectsPurchases,
  listContractsPage,
  listFundedMilestones,
  listJobPostsPage,
  listMilestonesForContracts,
  listPaidPayouts,
  listProposalsPage,
  listRecentAccounts,
  listRecentAgencies,
  listRecentContracts,
  listRecentEarnings,
  listRecentJobPosts,
  pingDatabase,
  sumCompletedConnectsPurchaseCents,
  sumContractTotalCents,
  sumPaidPayoutCents,
} from "./admin.repository.js";

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
    countAccountsByRole(db, "FREELANCER"),
    countAccountsByRole(db, "CLIENT"),
    countAgencies(db),
    countJobPosts(db),
    countProposals(db),
    countContracts(db),
    countActiveContracts(db),
    sumContractTotalCents(db),
    sumPaidPayoutCents(db),
    sumCompletedConnectsPurchaseCents(db),
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
      totalContractValueCents: toSafeCents(contractVolume?.value),
      totalPaidOutCents: toSafeCents(payoutVolume?.value),
      totalConnectsRevenueCents: toSafeCents(connectsRevenue?.value),
    },
  };
};

export const getAdminOverviewActivity = async (pagination: Pagination) => {
  const fetchLimit = pagination.offset + pagination.limit;

  const [recentAccounts, recentAgencies, recentJobs, recentContracts] =
    await Promise.all([
      listRecentAccounts(db, fetchLimit),
      listRecentAgencies(db, fetchLimit),
      listRecentJobPosts(db, fetchLimit),
      listRecentContracts(db, fetchLimit),
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
    listAccountsWithCompany(db, fetchLimit),
    listAgenciesWithOwner(db, fetchLimit),
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
  const rows = await listJobPostsPage(db, { limit, offset });

  return {
    results: rows.map((row) => ({
      ...row,
      clientName: row.companyName ?? "Unknown client",
    })),
    hasMore: rows.length === limit,
  };
};

export const getAdminProposals = async ({ limit, offset }: Pagination) => {
  const rows = await listProposalsPage(db, { limit, offset });

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
      jobBudgetCents: row.jobBudgetCents,
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
      bidAmountCents: row.bidAmountCents,
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
  const rows = await listContractsPage(db, { limit, offset });

  const freelancerIds = rows
    .map((row) => row.freelancerId)
    .filter((id): id is string => Boolean(id));
  const names = await clerkNames(freelancerIds);

  const milestoneRows = rows.length
    ? await listMilestonesForContracts(
        db,
        rows.map((row) => row.id),
      )
    : [];

  const results = rows.map((row) => {
    const freelancer = row.freelancerId
      ? names.get(row.freelancerId)
      : undefined;
    return {
      id: row.id,
      title: row.title,
      status: row.status,
      totalAmountCents: row.totalAmountCents,
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
      milestones: milestoneRows.filter(
        (milestone) => milestone.contractId === row.id,
      ),
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
      amountCents: number;
      createdAt: Date | null;
    }
  | {
      id: string;
      type: "EARNING";
      description: string;
      party: string;
      amountCents: number;
      createdAt: Date | null;
    }
  | {
      id: string;
      type: "PAYOUT";
      description: string;
      party: string;
      amountCents: number;
      createdAt: Date | null;
    }
  | {
      id: string;
      type: "CONNECTS_PURCHASE";
      description: string;
      party: string;
      amountCents: number;
      createdAt: Date | null;
    };

export const getAdminTransactions = async (pagination: Pagination) => {
  const fetchLimit = pagination.offset + pagination.limit;

  const [funded, earned, paidOut, connectsPurchases] = await Promise.all([
    listFundedMilestones(db, fetchLimit),
    listRecentEarnings(db, fetchLimit),
    listPaidPayouts(db, fetchLimit),
    listConnectsPurchases(db, fetchLimit),
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
      ? listAgencyNamesByIds(db, [...new Set(agencyIds)])
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
        amountCents: row.amountCents,
        createdAt: row.createdAt,
      })),
      earned.map((row) => ({
        id: row.id,
        type: "EARNING" as const,
        description: row.description,
        party: partyName(row.freelancerId, row.agencyId),
        amountCents: row.amountCents,
        createdAt: row.createdAt,
      })),
      paidOut.map((row) => ({
        id: row.id,
        type: "PAYOUT" as const,
        description: "Stripe payout",
        party: partyName(row.freelancerId, row.agencyId),
        amountCents: row.amountCents,
        createdAt: row.paidAt ?? row.createdAt,
      })),
      connectsPurchases.map((row) => ({
        id: row.id,
        type: "CONNECTS_PURCHASE" as const,
        description: `${row.purchasedConnects} Connects (${row.status})`,
        party: partyName(row.freelancerId, row.agencyId),
        amountCents: row.amountPaidCents,
        createdAt: row.createdAt,
      })),
    ],
    pagination,
  );
};

export const getSystemHealth = async () => {
  const startedAt = Date.now();

  const [redisResult, dbResult, rabbitResult] = await Promise.allSettled([
    (async () => {
      const start = Date.now();
      await redis.ping();
      return { ok: true, latencyMs: Date.now() - start };
    })(),
    (async () => {
      const start = Date.now();
      await pingDatabase(db);
      return { ok: true, latencyMs: Date.now() - start };
    })(),
    getRabbitStatus(),
  ]);

  const settle = async (
    result: PromiseSettledResult<{ ok: boolean; latencyMs: number }>,
    eventName: string,
    message: string,
  ): Promise<{ ok: boolean; latencyMs?: number }> => {
    if (result.status === "fulfilled") return result.value;
    await Promise.resolve()
      .then(() =>
        logger.error({
          message,
          eventName,
          attributes: errorLogAttributes(result.reason),
        }),
      )
      .catch(() => undefined);
    return { ok: false };
  };

  return {
    redis: await settle(
      redisResult,
      "admin.health.redis_failed",
      "Redis health check failed",
    ),
    database: await settle(
      dbResult,
      "admin.health.database_failed",
      "Database health check failed",
    ),
    rabbitmq:
      rabbitResult.status === "fulfilled" ? rabbitResult.value : { ok: false },
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
