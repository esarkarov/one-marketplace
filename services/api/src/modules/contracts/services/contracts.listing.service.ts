import { asc, desc, eq, inArray, sql } from "drizzle-orm";
import { clerk } from "../../../infrastructure/clerk.js";
import { env } from "../../../config/env.js";
import { db } from "../../../database/client.js";
import {
  agency_metadata,
  client_metadata,
  contract_milestones,
  contracts,
  conversations,
  job_posts,
} from "../../../database/schema.js";

export const getAccountContracts = async (
  userId: string,
  role: "client" | "freelancer" | "agency",
  agencyId?: string | null,
) => {
  const rows = await db
    .select({
      id: contracts.id,
      proposalId: contracts.proposal_id,
      jobId: contracts.job_id,
      clientId: contracts.client_id,
      freelancerId: contracts.freelancer_id,
      agencyId: contracts.agency_id,
      title: contracts.title,
      description: job_posts.description,
      totalAmountCents: contracts.total_amount_cents,
      status: contracts.status,
      startedAt: contracts.started_at,
      completedAt: contracts.completed_at,
      createdAt: contracts.created_at,
      conversationId: conversations.id,
      clientCompanyName: client_metadata.company_name,
      milestoneId: contract_milestones.id,
      milestoneTitle: contract_milestones.title,
      milestoneAmountCents: contract_milestones.amount_cents,
      milestoneDueDate: contract_milestones.due_date,
      milestonePosition: contract_milestones.position,
      milestoneStatus: contract_milestones.status,
      milestoneFundedAt: contract_milestones.funded_at,
      milestonePaymentRequestedAt: contract_milestones.payment_requested_at,
      milestoneSubmissionMessage: contract_milestones.submission_message,
      milestoneSubmissionDeliveryLink:
        contract_milestones.submission_delivery_link,
      milestoneCompletedAt: contract_milestones.completed_at,
      reviewedByCurrentUser:
        role === "agency" && agencyId
          ? sql<boolean>`exists(
              select 1 from reviews account_review
              where account_review.contract_id = ${contracts.id}
                and account_review.agency_id = ${agencyId}
                and account_review.reviewee_id = ${contracts.client_id}
            )`
          : sql<boolean>`exists(
              select 1 from reviews account_review
              where account_review.contract_id = ${contracts.id}
                and account_review.reviewer_id = ${userId}
            )`,
    })
    .from(contracts)
    .innerJoin(job_posts, eq(contracts.job_id, job_posts.id))
    .innerJoin(
      contract_milestones,
      eq(contract_milestones.contract_id, contracts.id),
    )
    .leftJoin(
      conversations,
      eq(conversations.proposal_id, contracts.proposal_id),
    )
    .leftJoin(client_metadata, eq(client_metadata.auth_id, contracts.client_id))
    .where(
      role === "client"
        ? eq(contracts.client_id, userId)
        : role === "agency"
          ? eq(contracts.agency_id, agencyId!)
          : eq(contracts.freelancer_id, userId),
    )
    .orderBy(desc(contracts.created_at), asc(contract_milestones.position));

  const counterpartyIds = [
    ...new Set(
      rows
        .map((row) => (role === "client" ? row.freelancerId : row.clientId))
        .filter((id): id is string => Boolean(id)),
    ),
  ];
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
    const agencyRows = await db
      .select({
        id: agency_metadata.id,
        name: agency_metadata.name,
        avatar: agency_metadata.avatar_image,
      })
      .from(agency_metadata)
      .where(inArray(agency_metadata.id, agencyIds));
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
    const counterpartyId =
      role === "client" ? (row.freelancerId ?? row.agencyId) : row.clientId;
    const isAgencyCounterparty =
      role === "client" && !row.freelancerId && Boolean(row.agencyId);
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
      counterpartyName: isAgencyCounterparty
        ? (agencyNames.get(row.agencyId!) ?? "Agency")
        : ((role === "freelancer" || role === "agency"
            ? row.clientCompanyName
            : null) ??
          names.get(counterpartyId ?? "") ??
          "Marketplace user"),
      counterpartyAvatar: isAgencyCounterparty
        ? (agencyAvatars.get(row.agencyId!) ?? null)
        : (avatars.get(counterpartyId ?? "") ?? null),
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

  return [...result.values()];
};
