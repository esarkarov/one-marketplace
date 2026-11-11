import { RequestHandler } from "express";
import { env } from "../../config/env.js";
import { stripe } from "../../config/stripe.js";
import { ApiResponse } from "../../types/common.types.js";
import { ApiError } from "../../utils/api-error.js";
import { asyncHandler } from "../../utils/async-handler.js";
import { moneyCents } from "../../utils/money.js";
import { requireClient } from "../proposals/proposals.controller.js";
import { requireFreelancer } from "../freelancer/freelancer.controller.js";
import { getAgencyIdForMember } from "../agency/agency.service.js";
import {
  acceptContract,
  createContractCheckout,
  createContractFromPayment,
  createMilestoneFundingCheckout,
  fundContractMilestoneFromPayment,
  getAccountContracts,
  submitContractMilestone,
  reviewContractMilestone,
  addContractMilestone,
  finishContractWithReview,
} from "./contracts.service.js";
import { sendNotification } from "../../events/publisher.js";
import { emitConversationUpdate } from "../messaging/messaging.socket.js";

const MIN_MILESTONE_CENTS = 1000;

const milestoneAmountCents = moneyCents.min(MIN_MILESTONE_CENTS);

const requireUuid = (value: unknown, label: string) => {
  if (
    typeof value !== "string" ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      value,
    )
  ) {
    throw new ApiError(400, `${label} is invalid.`);
  }
  return value;
};

export const startContractCheckout: RequestHandler = asyncHandler(
  async (request, response) => {
    const auth = requireClient(request);
    const url = await createContractCheckout(
      auth.userId,
      requireUuid(request.body?.proposalId, "Proposal"),
    );

    response.status(200).json({
      success: true,
      message: "Stripe Checkout created.",
      data: { url },
    } satisfies ApiResponse<{ url: string }>);
  },
);

export const startMilestoneFundingCheckout: RequestHandler = asyncHandler(
  async (request, response) => {
    const auth = requireClient(request);
    const requirements =
      typeof request.body?.requirements === "string"
        ? request.body.requirements.trim()
        : "";
    if (requirements.length > 500) {
      throw new ApiError(400, "Milestone requirements are too long.");
    }
    const url = await createMilestoneFundingCheckout(
      auth.userId,
      requireUuid(request.params.contractId, "Contract"),
      requireUuid(request.params.milestoneId, "Milestone"),
      requirements || undefined,
    );
    response.status(200).json({
      success: true,
      message: "Milestone checkout created.",
      data: { url },
    });
  },
);

export const getClientContracts: RequestHandler = asyncHandler(
  async (request, response) => {
    const auth = requireClient(request);
    const contracts = await getAccountContracts(auth.userId, "client");
    response.status(200).json({
      success: true,
      message: "Client contracts retrieved.",
      data: contracts,
    });
  },
);

export const getFreelancerContracts: RequestHandler = asyncHandler(
  async (request, response) => {
    const auth = requireFreelancer(request);
    const scope = request.query.scope === "agency" ? "agency" : "default";
    const agencyId =
      scope === "agency" ? await getAgencyIdForMember(auth.userId) : null;
    const contracts =
      scope === "agency"
        ? agencyId
          ? await getAccountContracts(auth.userId, "agency", agencyId)
          : []
        : await getAccountContracts(auth.userId, "freelancer");
    response.status(200).json({
      success: true,
      message: "Freelancer contracts retrieved.",
      data: contracts,
    });
  },
);

export const acceptContractOffer: RequestHandler = asyncHandler(
  async (request, response) => {
    const auth = requireFreelancer(request);
    const scope = request.query.scope === "agency" ? "agency" : "default";
    const agencyId =
      scope === "agency" ? await getAgencyIdForMember(auth.userId) : null;
    if (scope === "agency" && !agencyId) {
      throw new ApiError(403, "No agency account found.");
    }
    const contract = await acceptContract(
      requireUuid(request.params.contractId, "Contract"),
      auth.userId,
      agencyId,
    );

    await emitConversationUpdate(contract.conversationId, auth.userId);

    await Promise.all([
      sendNotification({
        recipientId: contract.clientId,
        type: "CONTRACT_ACCEPTED",
        title: "Contract offer accepted",
        message: contract.agencyId
          ? `The agency accepted your offer for “${contract.title}”.`
          : `The freelancer accepted your offer for “${contract.title}”.`,
        link: `/messages?conversationId=${contract.conversationId}`,
        metadata: { contractId: contract.id },
      }),
      sendNotification(
        contract.agencyId
          ? {
              agencyId: contract.agencyId,
              type: "CONTRACT_ACCEPTED",
              title: "Contract started",
              message: `Your contract for “${contract.title}” is now active.`,
              link: `/messages?conversationId=${contract.conversationId}`,
              metadata: { contractId: contract.id },
            }
          : {
              recipientId: contract.freelancerId,
              type: "CONTRACT_ACCEPTED",
              title: "Contract started",
              message: `Your contract for “${contract.title}” is now active.`,
              link: `/messages?conversationId=${contract.conversationId}`,
              metadata: { contractId: contract.id },
            },
      ),
    ]);
    response.status(200).json({
      success: true,
      message: "Contract offer accepted.",
      data: { contractId: contract.id, status: "ACTIVE" },
    });
  },
);

export const submitMilestoneWork: RequestHandler = asyncHandler(
  async (request, response) => {
    const auth = requireFreelancer(request);
    const scope = request.query.scope === "agency" ? "agency" : "default";
    const agencyId =
      scope === "agency" ? await getAgencyIdForMember(auth.userId) : null;
    if (scope === "agency" && !agencyId) {
      throw new ApiError(403, "No agency account found.");
    }
    const submissionMessage =
      typeof request.body?.submissionMessage === "string"
        ? request.body.submissionMessage.trim()
        : "";
    if (submissionMessage.length < 10) {
      throw new ApiError(
        400,
        "Submission message must be at least 10 characters.",
      );
    }

    const rawLink =
      typeof request.body?.submissionDeliveryLink === "string"
        ? request.body.submissionDeliveryLink.trim()
        : "";
    if (rawLink) {
      try {
        const url = new URL(rawLink);
        if (!["http:", "https:"].includes(url.protocol)) throw new Error();
      } catch {
        throw new ApiError(400, "Submission delivery link is invalid.");
      }
    }

    const milestone = await submitContractMilestone(
      requireUuid(request.params.contractId, "Contract"),
      requireUuid(request.params.milestoneId, "Milestone"),
      auth.userId,
      submissionMessage,
      rawLink || undefined,
      agencyId,
    );

    await emitConversationUpdate(milestone.conversationId, auth.userId);
    await sendNotification({
      recipientId: milestone.clientId,
      type: "MILESTONE_SUBMITTED",
      title: "Milestone submitted for review",
      message: `Work was submitted for “${milestone.milestoneTitle}”.`,
      link: `/messages?conversationId=${milestone.conversationId}`,
      metadata: {
        contractId: milestone.contractId,
        milestoneId: milestone.milestoneId,
      },
    });

    response.status(200).json({
      success: true,
      message: "Milestone submitted for review.",
      data: {
        milestoneId: milestone.milestoneId,
        paymentRequestedAt: new Date(),
      },
    });
  },
);

export const reviewMilestoneWork: RequestHandler = asyncHandler(
  async (request, response) => {
    const auth = requireClient(request);
    const action = request.body?.action;
    if (action !== "APPROVE" && action !== "REQUEST_CHANGES") {
      throw new ApiError(400, "Milestone review action is invalid.");
    }
    const feedback =
      typeof request.body?.feedback === "string"
        ? request.body.feedback.trim()
        : "";
    if (action === "REQUEST_CHANGES" && !feedback) {
      throw new ApiError(400, "Modification message is required.");
    }
    const milestone = await reviewContractMilestone(
      requireUuid(request.params.contractId, "Contract"),
      requireUuid(request.params.milestoneId, "Milestone"),
      auth.userId,
      action,
      feedback || undefined,
    );

    await emitConversationUpdate(milestone.conversationId, auth.userId);
    await sendNotification(
      milestone.agencyId
        ? {
            agencyId: milestone.agencyId,
            type: milestone.approved
              ? "MILESTONE_APPROVED"
              : "MILESTONE_CHANGES_REQUESTED",
            title: milestone.approved
              ? "Milestone accepted"
              : "Modifications requested",
            message: milestone.approved
              ? `Your work for “${milestone.milestoneTitle}” was accepted.`
              : `The client requested modifications for “${milestone.milestoneTitle}”.`,
            link: `/messages?conversationId=${milestone.conversationId}`,
            metadata: {
              contractId: milestone.contractId,
              milestoneId: milestone.milestoneId,
            },
          }
        : {
            recipientId: milestone.freelancerId,
            type: milestone.approved
              ? "MILESTONE_APPROVED"
              : "MILESTONE_CHANGES_REQUESTED",
            title: milestone.approved
              ? "Milestone accepted"
              : "Modifications requested",
            message: milestone.approved
              ? `Your work for “${milestone.milestoneTitle}” was accepted.`
              : `The client requested modifications for “${milestone.milestoneTitle}”.`,
            link: `/messages?conversationId=${milestone.conversationId}`,
            metadata: {
              contractId: milestone.contractId,
              milestoneId: milestone.milestoneId,
            },
          },
    );

    response.status(200).json({
      success: true,
      message: milestone.approved
        ? "Milestone work accepted."
        : "Modifications requested.",
      data: { milestoneId: milestone.milestoneId },
    });
  },
);

export const createAdditionalMilestone: RequestHandler = asyncHandler(
  async (request, response) => {
    const auth = requireClient(request);
    const title =
      typeof request.body?.title === "string" ? request.body.title.trim() : "";
    const amount = milestoneAmountCents.safeParse(request.body?.amountCents);
    const dueDate =
      typeof request.body?.dueDate === "string" ? request.body.dueDate : "";
    if (title.length < 3 || title.length > 120) {
      throw new ApiError(400, "Milestone title must be 3–120 characters.");
    }
    if (!amount.success) {
      throw new ApiError(
        400,
        "Milestone amount must be at least $10, in whole cents.",
      );
    }
    if (
      !/^\d{4}-\d{2}-\d{2}$/.test(dueDate) ||
      Number.isNaN(Date.parse(dueDate))
    ) {
      throw new ApiError(400, "Milestone due date is invalid.");
    }
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    if (new Date(`${dueDate}T00:00:00`) < today) {
      throw new ApiError(
        400,
        "Milestone due date cannot be earlier than today.",
      );
    }

    const milestone = await addContractMilestone(
      requireUuid(request.params.contractId, "Contract"),
      auth.userId,
      { title, amountCents: amount.data, dueDate },
    );
    response.status(201).json({
      success: true,
      message: "Milestone added.",
      data: milestone,
    });
  },
);

export const finishContract: RequestHandler = asyncHandler(
  async (request, response) => {
    if (!request.auth) throw new ApiError(401, "Authentication is required.");
    const role = request.auth.role;
    if (role !== "client" && role !== "freelancer") {
      throw new ApiError(403, "A marketplace account is required.");
    }
    const rating = Number(request.body?.rating);
    const comment =
      typeof request.body?.comment === "string"
        ? request.body.comment.trim()
        : "";
    if (!Number.isInteger(rating) || rating < 1 || rating > 5) {
      throw new ApiError(400, "Rating must be between 1 and 5.");
    }
    if (comment.length < 10 || comment.length > 1000) {
      throw new ApiError(400, "Review must be 10–1000 characters.");
    }

    const scope =
      role === "freelancer" && request.query.scope === "agency"
        ? "agency"
        : "default";
    const agencyId =
      scope === "agency"
        ? await getAgencyIdForMember(request.auth.userId)
        : null;
    if (scope === "agency" && !agencyId) {
      throw new ApiError(403, "No agency account found.");
    }

    const contract = await finishContractWithReview(
      requireUuid(request.params.contractId, "Contract"),
      request.auth.userId,
      role,
      rating,
      comment,
      agencyId,
    );

    if (contract.conversationId && contract.newlyCompleted) {
      await emitConversationUpdate(
        contract.conversationId,
        request.auth.userId,
      );
    }
    await sendNotification(
      contract.agencyId
        ? {
            agencyId: contract.agencyId,
            type: contract.newlyCompleted
              ? "CONTRACT_COMPLETED"
              : "REVIEW_RECEIVED",
            title: contract.newlyCompleted
              ? "Contract completed"
              : "New review received",
            message: contract.newlyCompleted
              ? `The contract “${contract.title}” was completed.`
              : `You received a review for “${contract.title}”.`,
            link: `/contracts?contractId=${contract.id}`,
            metadata: { contractId: contract.id },
          }
        : {
            recipientId: contract.revieweeId,
            type: contract.newlyCompleted
              ? "CONTRACT_COMPLETED"
              : "REVIEW_RECEIVED",
            title: contract.newlyCompleted
              ? "Contract completed"
              : "New review received",
            message: contract.newlyCompleted
              ? `The contract “${contract.title}” was completed.`
              : `You received a review for “${contract.title}”.`,
            link: `/contracts?contractId=${contract.id}`,
            metadata: { contractId: contract.id },
          },
    );

    response.status(200).json({
      success: true,
      message: contract.newlyCompleted
        ? "Contract completed and review submitted."
        : "Review submitted.",
      data: { contractId: contract.id, status: "COMPLETED" },
    });
  },
);

export const contractWebhook: RequestHandler = asyncHandler(
  async (request, response) => {
    const signature = request.headers["stripe-signature"];
    if (!env.stripeWebhookSecret || typeof signature !== "string") {
      await request.logger.warn({
        message: "Webhook signature rejected",
        eventName: "webhook.inbound.rejected",
        attributes: {
          "webhook.source": "stripe",
          "webhook.reject_reason": "missing_signature_or_secret",
        },
      });
      throw new ApiError(400, "Invalid Stripe webhook.");
    }

    let event: any;
    try {
      event = stripe.webhooks.constructEvent(
        request.body,
        signature,
        env.stripeWebhookSecret,
      );
    } catch {
      await request.logger.warn({
        message: "Webhook signature rejected",
        eventName: "webhook.inbound.rejected",
        attributes: {
          "webhook.source": "stripe",
          "webhook.reject_reason": "invalid_signature",
        },
      });
      throw new ApiError(400, "Invalid Stripe webhook signature.");
    }

    if (
      event.type === "checkout.session.completed" ||
      event.type === "checkout.session.async_payment_succeeded"
    ) {
      if (
        event.data.object.metadata?.paymentType === "CONTRACT_MILESTONE_FUNDING"
      ) {
        await fundContractMilestoneFromPayment(event.data.object);
      } else {
        await createContractFromPayment(event.data.object);
      }
    }

    response.status(200).json({ received: true });
  },
);
