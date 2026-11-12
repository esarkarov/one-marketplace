import { RequestHandler } from "express";
import { env } from "../../config/env.js";
import { stripe } from "../../infrastructure/stripe.js";
import { ApiResponse } from "../../types/common.types.js";
import { ApiError } from "../../shared/http/api-error.js";
import { asyncHandler } from "../../shared/http/async-handler.js";
import {
  requireClient,
  requireFreelancer,
} from "../../shared/http/role-guards.js";
import {
  getAgencyIdForMember,
  requireAgencyPermission,
} from "../agency/agency.public.js";
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
import { sendNotification } from "../../infrastructure/events/publisher.js";
import { emitConversationUpdate } from "../messaging/messaging.public.js";

export const startContractCheckout: RequestHandler = asyncHandler(
  async (request, response) => {
    const auth = requireClient(request);
    const url = await createContractCheckout(
      auth.userId,
      request.body.proposalId as string,
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
      (request.body.requirements as string | undefined) ?? "";
    const url = await createMilestoneFundingCheckout(
      auth.userId,
      request.params.contractId as string,
      request.params.milestoneId as string,
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
      scope === "agency"
        ? (await requireAgencyPermission(auth.userId, "contract.accept"))
            .agencyId
        : null;
    if (scope === "agency" && !agencyId) {
      throw new ApiError(403, "No agency account found.");
    }
    const contract = await acceptContract(
      request.params.contractId as string,
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
    const submissionMessage = request.body.submissionMessage as string;
    const rawLink =
      (request.body.submissionDeliveryLink as string | undefined) ?? "";
    if (rawLink) {
      try {
        const url = new URL(rawLink);
        if (!["http:", "https:"].includes(url.protocol)) throw new Error();
      } catch {
        throw new ApiError(400, "Submission delivery link is invalid.");
      }
    }

    const milestone = await submitContractMilestone(
      request.params.contractId as string,
      request.params.milestoneId as string,
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
    const action = request.body.action as "APPROVE" | "REQUEST_CHANGES";
    const feedback = (request.body.feedback as string | undefined) ?? "";
    if (action === "REQUEST_CHANGES" && !feedback) {
      throw new ApiError(400, "Modification message is required.");
    }
    const milestone = await reviewContractMilestone(
      request.params.contractId as string,
      request.params.milestoneId as string,
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
    const title = request.body.title as string;
    const amountCents = request.body.amountCents as number;
    const dueDate = request.body.dueDate as string;
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    if (new Date(`${dueDate}T00:00:00`) < today) {
      throw new ApiError(
        400,
        "Milestone due date cannot be earlier than today.",
      );
    }

    const milestone = await addContractMilestone(
      request.params.contractId as string,
      auth.userId,
      { title, amountCents, dueDate },
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
    const rating = request.body.rating as number;
    const comment = request.body.comment as string;

    const scope =
      role === "freelancer" && request.query.scope === "agency"
        ? "agency"
        : "default";
    const agencyId =
      scope === "agency"
        ? (
            await requireAgencyPermission(
              request.auth.userId,
              "contract.finish",
            )
          ).agencyId
        : null;
    if (scope === "agency" && !agencyId) {
      throw new ApiError(403, "No agency account found.");
    }

    const contract = await finishContractWithReview(
      request.params.contractId as string,
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
