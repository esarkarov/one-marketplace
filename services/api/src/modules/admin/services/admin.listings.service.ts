import {
  ADMIN_ACCOUNT_TYPE,
  type AdminAccountType,
  ADMIN_TALENT_KIND,
} from "@/modules/admin/constants/admin.constants.js";
import { db } from "@/database/client.js";
import { requirePublicId } from "@/shared/ids/public-ids.js";
import {
  findAccountDisplays,
  findAccountEmails,
  findAccountPublicIds,
} from "@/modules/auth/index.js";
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
} from "@/modules/admin/repositories/admin.repository.js";
import {
  Pagination,
  AdminAccountRow,
  AdminTransactionRow,
} from "@/modules/admin/types/admin.types.js";
import {
  fetchSize,
  toOffsetPage,
} from "@/shared/validation/utils/pagination.utils.js";
import { mergePages } from "@/modules/admin/utils/admin.pagination.js";

const storedNames = async (authIds: string[]) => {
  const unique = [...new Set(authIds)];
  const names = new Map<
    string,
    { name: string; avatarUrl: string | null; email: string | null }
  >();
  if (!unique.length) return names;

  const [displays, emails] = await Promise.all([
    findAccountDisplays(unique),
    findAccountEmails(unique),
  ]);
  for (const authId of unique) {
    const display = displays.get(authId);
    const email = emails.get(authId) ?? null;
    names.set(authId, {
      name: display?.displayName || email || "Unknown",
      avatarUrl: display?.avatarUrl ?? null,
      email,
    });
  }
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

  const names = await storedNames(personalRows.map((row) => row.authId));

  const people = personalRows.map((row) => ({
    id: row.id,
    authId: row.authId,
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
    authId: null,
    type: ADMIN_ACCOUNT_TYPE.AGENCY,
    name: row.name,
    avatarUrl: row.avatarImage?.url ?? null,
    email: row.ownerEmail,
    verified: row.ownerIdentityVerified === true,
    paymentVerified: false,
    onboarded: row.isOnboarded === true,
    createdAt: row.createdAt,
  }));

  return mergePages<AdminAccountRow>([people, agencies], pagination);
};

export const getAdminJobPosts = async ({ limit, offset }: Pagination) => {
  const { rows, hasMore } = toOffsetPage(
    await listJobPostsPage(db, { limit: fetchSize(limit), offset }),
    limit,
  );

  return {
    results: rows.map((row) => ({
      ...row,
      clientId: requirePublicId(row.clientId, "admin_get_job_posts", row.id),
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
    .map((row) => row.senderAuthId);
  const names = await storedNames(freelancerIds);

  const results = rows.map((row) => {
    const freelancer = names.get(row.senderAuthId);
    return {
      id: row.id,
      jobId: row.jobId,
      jobTitle: row.jobTitle,
      jobBudgetCents: row.jobBudgetCents,
      jobStatus: row.jobStatus,
      senderId:
        row.senderType === "AGENCY"
          ? row.senderAuthId
          : requirePublicId(row.senderAccountId, "admin_get_proposals", row.id),
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
    .map((row) => row.freelancerAuthId)
    .filter((id): id is string => Boolean(id));
  const [names, accountIdByAuthId] = await Promise.all([
    storedNames(freelancerIds),
    findAccountPublicIds(db, freelancerIds),
  ]);

  const milestoneRows = rows.length
    ? await listMilestonesForContracts(
        db,
        rows.map((row) => row.id),
      )
    : [];

  const results = rows.map((row) => {
    const freelancer = row.freelancerAuthId
      ? names.get(row.freelancerAuthId)
      : undefined;
    const talentId = row.agencyId
      ? row.agencyId
      : row.freelancerAuthId
        ? requirePublicId(
            accountIdByAuthId.get(row.freelancerAuthId),
            "admin_get_contracts",
            row.id,
          )
        : null;
    return {
      id: row.id,
      title: row.title,
      status: row.status,
      totalAmountCents: row.totalAmountCents,
      jobId: row.jobId,
      proposalId: row.proposalId,
      clientId: requirePublicId(row.clientId, "admin_get_contracts", row.id),
      clientName: row.companyName ?? "Unknown client",
      clientEmail: row.clientEmail,
      talentId,
      talentName:
        row.agencyName ??
        (row.freelancerAuthId
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
    storedNames(freelancerIds),
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
