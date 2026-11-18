import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { agencyInviteResponses } from "../../modules/agency/responses/agency.responses.js";
import { jobsCreateResponses } from "../../modules/jobs/responses/jobs.responses.js";
import { proposalsStatusResponses } from "../../modules/proposals/responses/proposals.responses.js";
import {
  INVITATION_STATUSES,
  JOB_STATUSES,
  PROPOSAL_STATUSES,
} from "../../shared/validation/constants/status.constants.js";

const proposalReview = (status: string) => ({
  success: true,
  message: "ok",
  data: {
    id: randomUUID(),
    senderId: randomUUID(),
    senderType: "FREELANCER",
    status,
    jobTitle: "Job",
    changed: true,
  },
});

const invitation = (status: string, role = "BUSINESS_MANAGER") => ({
  success: true,
  message: "ok",
  data: {
    id: randomUUID(),
    email: "a@b.test",
    role,
    status,
    createdAt: new Date().toISOString(),
    avatarUrl: null,
  },
});

const job = (status: string) => ({
  success: true,
  message: "ok",
  data: {
    id: randomUUID(),
    clientId: randomUUID(),
    title: "Job",
    description: "Details",
    expertiseLevel: "EXPERT",
    expectedDuration: "1 month",
    skills: ["node"],
    totalBudgetCents: 10000,
    milestones: [],
    screeningQuestions: null,
    attachments: null,
    status,
    publishedAt: null,
    hiredAt: null,
    createdAt: null,
    updatedAt: null,
  },
});

describe("status response schemas", () => {
  it.each(PROPOSAL_STATUSES)("accepts proposal status %s", (status) => {
    expect(
      proposalsStatusResponses[200].safeParse(proposalReview(status)).success,
    ).toBe(true);
  });

  it("rejects an unknown proposal status", () => {
    expect(
      proposalsStatusResponses[200].safeParse(proposalReview("REJECTED"))
        .success,
    ).toBe(false);
    expect(
      proposalsStatusResponses[200].safeParse(proposalReview("submitted"))
        .success,
    ).toBe(false);
  });

  it.each(JOB_STATUSES)("accepts job status %s", (status) => {
    expect(jobsCreateResponses[201].safeParse(job(status)).success).toBe(true);
  });

  it("rejects an unknown job status", () => {
    expect(jobsCreateResponses[201].safeParse(job("CLOSED")).success).toBe(
      false,
    );
  });

  it.each(INVITATION_STATUSES)("accepts invitation status %s", (status) => {
    expect(
      agencyInviteResponses[201].safeParse(invitation(status)).success,
    ).toBe(true);
  });

  it("rejects an unknown invitation status and the old member role", () => {
    expect(
      agencyInviteResponses[201].safeParse(invitation("EXPIRED")).success,
    ).toBe(false);
    expect(
      agencyInviteResponses[201].safeParse(
        invitation("PENDING", "Business manager"),
      ).success,
    ).toBe(false);
  });
});
