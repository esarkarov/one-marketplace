import { RequestHandler } from "express";
import { env } from "../../../config/env.js";
import { verifyStripeWebhook } from "../../../infrastructure/payments/stripe.webhook.js";
import { ApiResponse } from "../../../types/common.types.js";
import { ApiError } from "../../../shared/errors/api-error.js";
import { asyncHandler } from "../../../middleware/utils/async-handler.utils.js";
import { getValidated } from "../../../middleware/utils/validated-request.utils.js";
import {
  requireClient,
  requireFreelancer,
} from "../../../middleware/auth/role-guards.middleware.js";
import {
  getAgencyIdForMember,
  requireAgencyPermission,
} from "../../agency/index.js";
import {
  createContractCheckout,
  createMilestoneFundingCheckout,
  fundContractMilestoneFromPayment,
} from "../services/contracts.checkout.service.js";
import {
  acceptContractRequest,
  addMilestoneRequest,
  clientContractsRequest,
  contractCheckoutRequest,
  declineContractRequest,
  finishContractRequest,
  freelancerContractsRequest,
  milestoneCheckoutRequest,
  reviewMilestoneRequest,
  submitMilestoneRequest,
  withdrawContractRequest,
} from "../schemas/contracts.schema.js";
import { getAccountContracts } from "../services/contracts.listing.service.js";
import {
  acceptContract,
  cancelPendingContract,
  createContractFromPayment,
  finishContractWithReview,
} from "../services/contracts.lifecycle.service.js";
import {
  addContractMilestone,
  reviewContractMilestone,
  submitContractMilestone,
} from "../services/contracts.milestones.service.js";
import { sendNotification } from "../../../infrastructure/events/notification.publisher.js";
import { emitConversationUpdate } from "../../messaging/index.js";

export const startContractCheckout: RequestHandler = asyncHandler(
  async (request, response) => {
    const auth = requireClient(request);
    const { body } = getValidated(request, contractCheckoutRequest);
    const url = await createContractCheckout(auth.userId, body.proposalId);

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
    const { params, body } = getValidated(request, milestoneCheckoutRequest);
    const requirements = body.requirements ?? "";
    const url = await createMilestoneFundingCheckout(
      auth.userId,
      params.contractId,
      params.milestoneId,
      requirements || undefined,
    );
    response.status(200).json({
      success: true,
      message: "Milestone checkout created.",
      data: { url },
    });
  },
);

const pageOf = (query: { limit: number; offset: number }) => ({
  limit: query.limit,
  offset: query.offset,
});

export const getClientContracts: RequestHandler = asyncHandler(
  async (request, response) => {
    const auth = requireClient(request);
    const { query } = getValidated(request, clientContractsRequest);
    const contracts = await getAccountContracts(
      auth.userId,
      "client",
      null,
      pageOf(query),
    );
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
    const { query } = getValidated(request, freelancerContractsRequest);
    const scope = query.scope === "agency" ? "agency" : "default";
    const agencyId =
      scope === "agency" ? await getAgencyIdForMember(auth.userId) : null;
    const contracts =
      scope === "agency"
        ? agencyId
          ? await getAccountContracts(
              auth.userId,
              "agency",
              agencyId,
              pageOf(query),
            )
          : { results: [], hasMore: false }
        : await getAccountContracts(
            auth.userId,
            "freelancer",
            null,
            pageOf(query),
          );
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
    const { params, query } = getValidated(request, acceptContractRequest);
    const scope = query.scope === "agency" ? "agency" : "default";
    const agencyId =
      scope === "agency"
        ? (await requireAgencyPermission(auth.userId, "contract.accept"))
            .agencyId
        : null;
    if (scope === "agency" && !agencyId) {
      throw new ApiError(403, "No agency account found.");
    }
    const contract = await acceptContract(
      params.contractId,
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

export const declineContractOffer: RequestHandler = asyncHandler(
  async (request, response) => {
    const auth = requireFreelancer(request);
    const { params, query } = getValidated(request, declineContractRequest);
    const scope = query.scope === "agency" ? "agency" : "default";
    const agencyId =
      scope === "agency"
        ? (await requireAgencyPermission(auth.userId, "contract.accept"))
            .agencyId
        : null;
    if (scope === "agency" && !agencyId) {
      throw new ApiError(403, "No agency account found.");
    }
    const contract = await cancelPendingContract(params.contractId, {
      kind: "talent",
      freelancerId: auth.userId,
      agencyId,
    });

    if (!contract.alreadyCancelled) {
      await emitConversationUpdate(contract.conversationId, auth.userId);
      await sendNotification({
        recipientId: contract.clientId,
        type: "CONTRACT_DECLINED",
        title: "Contract offer declined",
        message: `Your offer for “${contract.title}” was declined and your payment is being refunded.`,
        link: `/contracts?contractId=${contract.id}`,
        metadata: { contractId: contract.id },
      });
    }
    response.status(200).json({
      success: true,
      message: contract.alreadyCancelled
        ? "Contract cancelled."
        : "Contract offer declined.",
      data: { contractId: contract.id, status: contract.status },
    });
  },
);

export const withdrawContractOffer: RequestHandler = asyncHandler(
  async (request, response) => {
    const auth = requireClient(request);
    const { params } = getValidated(request, withdrawContractRequest);
    const contract = await cancelPendingContract(params.contractId, {
      kind: "client",
      clientId: auth.userId,
    });

    if (!contract.alreadyCancelled) {
      await emitConversationUpdate(contract.conversationId, auth.userId);
      const content = {
        type: "CONTRACT_WITHDRAWN",
        title: "Contract offer withdrawn",
        message: `The client withdrew the offer for “${contract.title}”.`,
        link: `/messages?conversationId=${contract.conversationId}`,
        metadata: { contractId: contract.id },
      };
      if (contract.agencyId) {
        await sendNotification({ agencyId: contract.agencyId, ...content });
      } else if (contract.freelancerId) {
        await sendNotification({
          recipientId: contract.freelancerId,
          ...content,
        });
      }
    }
    response.status(200).json({
      success: true,
      message: contract.alreadyCancelled
        ? "Contract cancelled."
        : "Contract offer withdrawn.",
      data: { contractId: contract.id, status: contract.status },
    });
  },
);

export const submitMilestoneWork: RequestHandler = asyncHandler(
  async (request, response) => {
    const auth = requireFreelancer(request);
    const { params, query, body } = getValidated(
      request,
      submitMilestoneRequest,
    );
    const scope = query.scope === "agency" ? "agency" : "default";
    const agencyId =
      scope === "agency" ? await getAgencyIdForMember(auth.userId) : null;
    if (scope === "agency" && !agencyId) {
      throw new ApiError(403, "No agency account found.");
    }
    const submissionMessage = body.submissionMessage;
    const rawLink = body.submissionDeliveryLink ?? "";
    if (rawLink) {
      try {
        const url = new URL(rawLink);
        if (!["http:", "https:"].includes(url.protocol)) throw new Error();
      } catch {
        throw new ApiError(400, "Submission delivery link is invalid.");
      }
    }

    const milestone = await submitContractMilestone(
      params.contractId,
      params.milestoneId,
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
    const { params, body } = getValidated(request, reviewMilestoneRequest);
    const action = body.action;
    const feedback = body.feedback ?? "";
    if (action === "REQUEST_CHANGES" && !feedback) {
      throw new ApiError(400, "Modification message is required.");
    }
    const milestone = await reviewContractMilestone(
      params.contractId,
      params.milestoneId,
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
    const { params, body } = getValidated(request, addMilestoneRequest);
    const title = body.title;
    const amountCents = body.amountCents;
    const dueDate = body.dueDate;
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    if (new Date(`${dueDate}T00:00:00`) < today) {
      throw new ApiError(
        400,
        "Milestone due date cannot be earlier than today.",
      );
    }

    const milestone = await addContractMilestone(
      params.contractId,
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
    const { params, query, body } = getValidated(
      request,
      finishContractRequest,
    );
    const rating = body.rating;
    const comment = body.comment;

    const scope =
      role === "freelancer" && query.scope === "agency" ? "agency" : "default";
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
      params.contractId,
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
    const event = await verifyStripeWebhook(request, {
      secret: env.stripeWebhookSecret,
      source: "stripe",
      missingMessage: "Invalid Stripe webhook.",
    });

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
