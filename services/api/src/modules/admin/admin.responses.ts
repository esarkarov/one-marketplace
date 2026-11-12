import { z } from "zod";
import {
  ErrorBody,
  cents,
  isoDateTime,
  ok,
  okNoData,
  offsetPage,
  BadRequestBody,
} from "../../utils/response-schemas.js";

const nullableDateTime = isoDateTime.nullable();

const ActivityItem = z
  .strictObject({
    type: z.string(),
    id: z.uuid(),
    title: z.string(),
    createdAt: isoDateTime,
  })
  .meta({ id: "AdminActivityItem" });

const AccountItem = z
  .strictObject({
    id: z.string(),
    type: z.enum(["Freelancer", "Client", "Agency"]),
    name: z.string(),
    avatarUrl: z.string().nullable(),
    email: z.string(),
    verified: z.boolean(),
    paymentVerified: z.boolean(),
    onboarded: z.boolean(),
    createdAt: isoDateTime,
  })
  .meta({ id: "AdminAccountItem" });

const JobPostItem = z
  .strictObject({
    id: z.uuid(),
    title: z.string(),
    description: z.string(),
    status: z.string(),
    totalBudgetCents: cents,
    expertiseLevel: z.string(),
    expectedDuration: z.string(),
    skills: z.array(z.string()),
    milestones: z.array(
      z.strictObject({
        id: z.string(),
        title: z.string(),
        budgetCents: cents,
        dueDate: z.string(),
      }),
    ),
    screeningQuestions: z.array(z.string()).nullable(),
    attachments: z
      .array(
        z.strictObject({
          fileId: z.string(),
          fileName: z.string(),
          fileUrl: z.string(),
          fileType: z.string(),
          fileSize: z.number().int().min(0),
        }),
      )
      .nullable(),
    clientId: z.string(),
    companyName: z.string().nullable(),
    companyWebsite: z.string().nullable(),
    industry: z.string().nullable(),
    companyDescription: z.string().nullable(),
    clientEmail: z.string().nullable(),
    createdAt: nullableDateTime,
    updatedAt: nullableDateTime,
    publishedAt: nullableDateTime,
    hiredAt: nullableDateTime,
    proposalCount: z.number().int().min(0),
    hireCount: z.number().int().min(0),
    clientName: z.string(),
  })
  .meta({ id: "AdminJobPostItem" });

const ProposalItem = z
  .strictObject({
    id: z.uuid(),
    jobId: z.uuid(),
    jobTitle: z.string(),
    jobBudgetCents: cents,
    jobStatus: z.string(),
    senderId: z.string(),
    senderType: z.enum(["FREELANCER", "AGENCY"]),
    senderName: z.string(),
    senderAvatarUrl: z.string().nullable(),
    senderEmail: z.string().nullable(),
    agencySpecialty: z.string().nullable(),
    agencyWebsite: z.string().nullable(),
    coverLetter: z.string(),
    bidAmountCents: cents,
    duration: z.string(),
    screeningAnswers: z.array(
      z.strictObject({ question: z.string(), answer: z.string() }),
    ),
    status: z.string(),
    isShortlisted: z.boolean(),
    createdAt: nullableDateTime,
    updatedAt: nullableDateTime,
  })
  .meta({ id: "AdminProposalItem" });

const status = z.enum(["PENDING", "ACTIVE", "COMPLETED"]);

const ContractMilestoneItem = z
  .strictObject({
    id: z.uuid(),
    contractId: z.uuid(),
    title: z.string(),
    amountCents: cents,
    dueDate: z.iso.date(),
    position: z.number().int().min(0),
    status,
    fundedAt: nullableDateTime,
    submissionMessage: z.string().nullable(),
    submissionDeliveryLink: z.string().nullable(),
    completedAt: nullableDateTime,
  })
  .meta({ id: "AdminContractMilestoneItem" });

const ContractItem = z
  .strictObject({
    id: z.uuid(),
    title: z.string(),
    status,
    totalAmountCents: cents,
    jobId: z.uuid(),
    proposalId: z.uuid(),
    clientId: z.string(),
    clientName: z.string(),
    clientEmail: z.string().nullable(),
    talentId: z.string().nullable(),
    talentName: z.string(),
    talentAvatarUrl: z.string().nullable(),
    talentEmail: z.string().nullable(),
    agencySpecialty: z.string().nullable(),
    agencyWebsite: z.string().nullable(),
    talentKind: z.enum(["Agency", "Freelancer"]),
    createdAt: isoDateTime,
    updatedAt: isoDateTime,
    startedAt: nullableDateTime,
    completedAt: nullableDateTime,
    milestones: z.array(ContractMilestoneItem),
  })
  .meta({ id: "AdminContractItem" });

const TransactionItem = z
  .strictObject({
    id: z.uuid(),
    type: z.enum([
      "MILESTONE_FUNDED",
      "EARNING",
      "PAYOUT",
      "CONNECTS_PURCHASE",
    ]),
    description: z.string(),
    party: z.string(),
    amountCents: cents,
    createdAt: isoDateTime,
  })
  .meta({ id: "AdminTransactionItem" });

const ServiceCheck = z
  .strictObject({
    ok: z.boolean(),
    latencyMs: z.number().min(0).optional(),
  })
  .meta({ id: "AdminServiceCheck" });

const ProcessInfo = z.strictObject({
  uptimeSeconds: z.number().int().min(0),
  memory: z.strictObject({
    rss: z.number().min(0),
    heapTotal: z.number().min(0),
    heapUsed: z.number().min(0),
    external: z.number().min(0),
    arrayBuffers: z.number().min(0),
  }),
  loadAverage: z.array(z.number().min(0)),
  cpuCount: z.number().int().min(0),
  totalMemoryMb: z.number().int().min(0),
  freeMemoryMb: z.number().int().min(0),
  nodeVersion: z.string(),
});

const RedisKeyValue = z.union([
  z.string(),
  z.array(z.string()),
  z.record(z.string(), z.string()),
  z.array(z.strictObject({ value: z.string(), score: z.number() })),
]);

export const adminResponses = {
  logsStream: {
    503: ErrorBody,
  },
  login: {
    200: okNoData,
    401: ErrorBody,
    503: ErrorBody,
  },
  overview: {
    200: ok(
      z.strictObject({
        totals: z.strictObject({
          freelancers: z.number().int().min(0),
          clients: z.number().int().min(0),
          agencies: z.number().int().min(0),
          jobPosts: z.number().int().min(0),
          proposals: z.number().int().min(0),
          contracts: z.number().int().min(0),
          activeContracts: z.number().int().min(0),
        }),
        volume: z.strictObject({
          totalContractValueCents: cents,
          totalPaidOutCents: cents,
          totalConnectsRevenueCents: cents,
        }),
      }),
    ),
  },
  activity: { 200: ok(offsetPage(ActivityItem)) },
  accounts: { 200: ok(offsetPage(AccountItem)) },
  jobPosts: { 200: ok(offsetPage(JobPostItem)) },
  proposals: { 200: ok(offsetPage(ProposalItem)) },
  contracts: { 200: ok(offsetPage(ContractItem)) },
  transactions: { 200: ok(offsetPage(TransactionItem)) },
  systemHealth: {
    200: ok(
      z.strictObject({
        redis: ServiceCheck,
        database: ServiceCheck,
        rabbitmq: ServiceCheck,
        process: ProcessInfo,
        checkedAt: isoDateTime,
      }),
    ),
  },
  redisKeys: {
    200: ok(
      z.strictObject({
        keys: z.array(
          z.strictObject({
            key: z.string(),
            type: z.string(),
            ttl: z.number().int(),
          }),
        ),
        truncated: z.boolean(),
      }),
    ),
    400: BadRequestBody,
  },
  redisKey: {
    200: ok(
      z.strictObject({
        type: z.string(),
        ttl: z.number().int(),
        value: RedisKeyValue.nullable(),
        truncated: z.boolean().optional(),
      }),
    ),
    403: ErrorBody,
  },
};
