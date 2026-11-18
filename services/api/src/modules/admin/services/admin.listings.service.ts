import {
  ADMIN_ACCOUNT_TYPE,
  type AdminAccountType,
  ADMIN_TALENT_KIND,
} from "../constants/admin.constants.js";
import { clerk } from "../../../infrastructure/auth/clerk.client.js";
import { db } from "../../../database/client.js";
import { env } from "../../../config/env.js";
import {
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
  listRecentEarnings,
} from "../repositories/admin.repository.js";
import { Pagination, AdminTransactionRow } from "../types/admin.types.js";
import {
  fetchSize,
  toOffsetPage,
} from "../../../shared/validation/utils/pagination.utils.js";
import { mergePages } from "../utils/admin.pagination.js";

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

const personAccountType = (role: string): AdminAccountType =>
  role === "FREELANCER"
    ? ADMIN_ACCOUNT_TYPE.FREELANCER
    : ADMIN_ACCOUNT_TYPE.CLIENT;

export const getAdminAccounts = async (pagination: Pagination) => {
  const fetchLimit = pagination.offset + fetchSize(pagination.limit);

  const [personalRows, agencyRows] = await Promise.all([
    listAccountsWithCompany(db, fetchLimit),
    listAgenciesWithOwner(db, fetchLimit),
  ]);

  const names = await clerkNames(personalRows.map((row) => row.authId));

  const people = personalRows.map((row) => ({
    id: row.authId,
    type: personAccountType(row.role),
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
    type: ADMIN_ACCOUNT_TYPE.AGENCY,
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
  const { rows, hasMore } = toOffsetPage(
    await listJobPostsPage(db, { limit: fetchSize(limit), offset }),
    limit,
  );

  return {
    results: rows.map((row) => ({
      ...row,
      clientName: row.companyName ?? "Unknown client",
    })),
    hasMore,
  };
};

export const getAdminProposals = async ({ limit, offset }: Pagination) => {
  const { rows, hasMore } = toOffsetPage(
    await listProposalsPage(db, { limit: fetchSize(limit), offset }),
    limit,
  );

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

  return { results, hasMore };
};

export const getAdminContracts = async ({ limit, offset }: Pagination) => {
  const { rows, hasMore } = toOffsetPage(
    await listContractsPage(db, { limit: fetchSize(limit), offset }),
    limit,
  );

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
      talentKind: row.agencyId
        ? ADMIN_TALENT_KIND.AGENCY
        : ADMIN_TALENT_KIND.FREELANCER,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
      startedAt: row.startedAt,
      completedAt: row.completedAt,
      milestones: milestoneRows.filter(
        (milestone) => milestone.contractId === row.id,
      ),
    };
  });

  return { results, hasMore };
};

export const getAdminTransactions = async (pagination: Pagination) => {
  const fetchLimit = pagination.offset + fetchSize(pagination.limit);

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
