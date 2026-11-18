import { clerk } from "../../../infrastructure/auth/clerk.client.js";
import { env } from "../../../config/env.js";
import {
  listAccountContractIds,
  listAgencySummariesByIds,
  listContractRows,
  listPublicAccountIds,
} from "../repositories/contracts.repository.js";
import { db } from "../../../database/client.js";
import { requirePublicId } from "../../../shared/ids/public-ids.js";
import type { CounterpartyType } from "../constants/contracts.constants.js";
import {
  fetchSize,
  toOffsetPage,
} from "../../../shared/validation/utils/pagination.utils.js";

export const getAccountContracts = async (
  userId: string,
  role: "client" | "freelancer" | "agency",
  agencyId: string | null | undefined,
  { limit, offset }: { limit: number; offset: number },
) => {
  const { rows: pageIds, hasMore } = toOffsetPage(
    await listAccountContractIds(db, userId, role, agencyId, {
      limit: fetchSize(limit),
      offset,
    }),
    limit,
  );
  if (!pageIds.length) return { results: [], hasMore: false };

  const rows = await listContractRows(
    db,
    userId,
    role,
    agencyId,
    pageIds.map((row) => row.id),
  );

  const counterpartyIds = [
    ...new Set(
      rows
        .map((row) => (role === "client" ? row.freelancerId : row.clientId))
        .filter((id): id is string => Boolean(id)),
    ),
  ];
  const publicIds = new Map(
    counterpartyIds.length
      ? (await listPublicAccountIds(db, counterpartyIds)).map((account) => [
          account.authId,
          account.id,
        ])
      : [],
  );
  const names = new Map<string, string>();
  const avatars = new Map<string, string | null>();
  if (env.clerkSecretKey && counterpartyIds.length) {
    await Promise.all(
      counterpartyIds.map(async (accountId) => {
        try {
          const user = await clerk.users.getUser(accountId);
          names.set(
            accountId,
            [user.firstName, user.lastName].filter(Boolean).join(" ") ||
              "Marketplace user",
          );
          avatars.set(accountId, user.imageUrl || null);
        } catch {
          names.set(accountId, "Marketplace user");
          avatars.set(accountId, null);
        }
      }),
    );
  }

  const agencyIds = [
    ...new Set(
      role === "client"
        ? rows
            .map((row) => row.agencyId)
            .filter((id): id is string => Boolean(id))
        : [],
    ),
  ];
  const agencyNames = new Map<string, string>();
  const agencyAvatars = new Map<string, string | null>();
  if (agencyIds.length) {
    const agencyRows = await listAgencySummariesByIds(db, agencyIds);
    agencyRows.forEach((row) => {
      agencyNames.set(row.id, row.name ?? "Agency");
      agencyAvatars.set(row.id, row.avatar?.url ?? null);
    });
  }

  type ContractRow = (typeof rows)[number];
  type ContractListItem = Pick<
    ContractRow,
    | "id"
    | "proposalId"
    | "jobId"
    | "title"
    | "description"
    | "totalAmountCents"
    | "status"
    | "startedAt"
    | "completedAt"
    | "createdAt"
    | "conversationId"
    | "reviewedByCurrentUser"
  > & {
    counterpartyId: string | null;
    counterpartyType: CounterpartyType;
    counterpartyName: string;
    counterpartyAvatar: string | null;
    milestones: {
      id: ContractRow["milestoneId"];
      title: ContractRow["milestoneTitle"];
      amountCents: ContractRow["milestoneAmountCents"];
      dueDate: ContractRow["milestoneDueDate"];
      position: ContractRow["milestonePosition"];
      status: ContractRow["milestoneStatus"];
      fundedAt: ContractRow["milestoneFundedAt"];
      paymentRequestedAt: ContractRow["milestonePaymentRequestedAt"];
      submissionMessage: ContractRow["milestoneSubmissionMessage"];
      submissionDeliveryLink: ContractRow["milestoneSubmissionDeliveryLink"];
      completedAt: ContractRow["milestoneCompletedAt"];
    }[];
  };
  const result = new Map<string, ContractListItem>();
  for (const row of rows) {
    const operation =
      role === "client" ? "contracts_get_client" : "contracts_get_freelancer";
    const counterpartyAuthId =
      role === "client" ? (row.freelancerId ?? row.agencyId) : row.clientId;
    const isAgencyCounterparty =
      role === "client" && !row.freelancerId && Boolean(row.agencyId);
    const counterpartyType: CounterpartyType =
      role !== "client"
        ? "CLIENT"
        : isAgencyCounterparty
          ? "AGENCY"
          : "FREELANCER";
    const counterpartyId = isAgencyCounterparty
      ? row.agencyId
      : counterpartyAuthId
        ? requirePublicId(publicIds.get(counterpartyAuthId), operation, row.id)
        : null;
    const contract = result.get(row.id) ?? {
      id: row.id,
      proposalId: row.proposalId,
      jobId: row.jobId,
      title: row.title,
      description: row.description,
      totalAmountCents: row.totalAmountCents,
      status: row.status,
      startedAt: row.startedAt,
      completedAt: row.completedAt,
      createdAt: row.createdAt,
      conversationId: row.conversationId,
      counterpartyId,
      counterpartyType,
      counterpartyName: isAgencyCounterparty
        ? (agencyNames.get(row.agencyId!) ?? "Agency")
        : ((role === "freelancer" || role === "agency"
            ? row.clientCompanyName
            : null) ??
          names.get(counterpartyAuthId ?? "") ??
          "Marketplace user"),
      counterpartyAvatar: isAgencyCounterparty
        ? (agencyAvatars.get(row.agencyId!) ?? null)
        : (avatars.get(counterpartyAuthId ?? "") ?? null),
      reviewedByCurrentUser: row.reviewedByCurrentUser,
      milestones: [],
    };
    contract.milestones.push({
      id: row.milestoneId,
      title: row.milestoneTitle,
      amountCents: row.milestoneAmountCents,
      dueDate: row.milestoneDueDate,
      position: row.milestonePosition,
      status: row.milestoneStatus,
      fundedAt: row.milestoneFundedAt,
      paymentRequestedAt: row.milestonePaymentRequestedAt,
      submissionMessage: row.milestoneSubmissionMessage,
      submissionDeliveryLink: row.milestoneSubmissionDeliveryLink,
      completedAt: row.milestoneCompletedAt,
    });
    result.set(row.id, contract);
  }

  return { results: [...result.values()], hasMore };
};
