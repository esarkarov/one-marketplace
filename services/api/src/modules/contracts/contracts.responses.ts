import { z } from "zod";
import {
  ErrorBody,
  cents,
  isoDateTime,
  ok,
  BadRequestBody,
} from "../../shared/validation/response-schemas.js";

const codedError = <const C extends readonly [string, ...string[]]>(
  codes: C,
  optionalCode = false,
) => {
  const code = z.enum(codes);
  return z.strictObject({
    success: z.literal(false),
    message: z.string(),
    code: optionalCode ? code.optional() : code,
  });
};

const uncodedError = z.strictObject({
  success: z.literal(false),
  message: z.string(),
});

const agencyForbidden = codedError(["AGENCY_PERMISSION_DENIED"], true);

const nullableDateTime = isoDateTime.nullable();

const milestoneStatus = z.enum(["PENDING", "ACTIVE", "COMPLETED"]);
const contractStatus = z.enum(["PENDING", "ACTIVE", "COMPLETED"]);

const ContractMilestone = z
  .strictObject({
    id: z.uuid(),
    title: z.string(),
    amountCents: cents,
    dueDate: z.iso.date(),
    position: z.number().int().min(0),
    status: milestoneStatus,
    fundedAt: nullableDateTime,
    paymentRequestedAt: nullableDateTime,
    submissionMessage: z.string().nullable(),
    submissionDeliveryLink: z.string().nullable(),
    completedAt: nullableDateTime,
  })
  .meta({ id: "ContractsMilestone" });

const ContractSummary = z
  .strictObject({
    id: z.uuid(),
    proposalId: z.uuid(),
    jobId: z.uuid(),
    title: z.string(),
    description: z.string(),
    totalAmountCents: cents,
    status: contractStatus,
    startedAt: nullableDateTime,
    completedAt: nullableDateTime,
    createdAt: isoDateTime,
    conversationId: z.uuid().nullable(),
    counterpartyId: z.string().nullable(),
    counterpartyName: z.string(),
    counterpartyAvatar: z.string().nullable(),
    reviewedByCurrentUser: z.boolean(),
    milestones: z.array(ContractMilestone),
  })
  .meta({ id: "ContractsContract" });

const checkoutUrl = z.strictObject({ url: z.string() });

export const contractsResponses = {
  client: {
    200: ok(z.array(ContractSummary)),
    403: ErrorBody,
  },
  freelancer: {
    200: ok(z.array(ContractSummary)),
    403: ErrorBody,
  },
  accept: {
    200: ok(
      z.strictObject({ contractId: z.uuid(), status: z.literal("ACTIVE") }),
    ),
    403: agencyForbidden,
    404: ErrorBody,
    409: codedError(["CONTRACT_OFFER_NOT_ACCEPTABLE"], true),
  },
  submit: {
    200: ok(
      z.strictObject({
        milestoneId: z.uuid(),
        paymentRequestedAt: isoDateTime,
      }),
    ),
    400: BadRequestBody,
    403: ErrorBody,
    404: ErrorBody,
    409: codedError(["MILESTONE_NOT_SUBMITTABLE"]),
  },
  review: {
    200: ok(z.strictObject({ milestoneId: z.uuid() })),
    403: ErrorBody,
    404: ErrorBody,
    409: uncodedError,
  },
  checkout: {
    200: ok(checkoutUrl),
    400: BadRequestBody,
    403: ErrorBody,
    404: ErrorBody,
  },
  milestoneCheckout: {
    200: ok(checkoutUrl),
    403: ErrorBody,
    404: ErrorBody,
    409: uncodedError,
  },
  addMilestone: {
    201: ok(
      z.strictObject({
        id: z.uuid(),
        title: z.string(),
        amountCents: cents,
        dueDate: z.iso.date(),
        status: z.literal("PENDING"),
      }),
    ),
    403: ErrorBody,
    404: ErrorBody,
    409: codedError(["MILESTONE_ADD_NOT_ALLOWED"]),
  },
  finish: {
    200: ok(
      z.strictObject({ contractId: z.uuid(), status: z.literal("COMPLETED") }),
    ),
    403: agencyForbidden,
    404: ErrorBody,
    409: codedError(
      [
        "REVIEW_ALREADY_SUBMITTED",
        "CONTRACT_ALREADY_FINISHED",
        "CONTRACT_HAS_INCOMPLETE_MILESTONES",
      ],
      true,
    ),
  },
};
