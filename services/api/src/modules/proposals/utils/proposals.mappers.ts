import { requirePublicId } from "../../../shared/ids/public-ids.js";

interface ProposalRow {
  id: string;
  job_id: string;
  sender_id: string;
  sender_type: string;
  cover_letter: string;
  bid_amount_cents: number;
  duration: string;
  screening_answers: { question: string; answer: string }[];
  status: string;
  is_shortlisted: boolean;
  created_at: Date | null;
  updated_at: Date | null;
}

interface ProposalSender {
  senderId: string;
  senderType: string;
  senderAccountId: string | null | undefined;
}

export const toProposalSenderId = (
  sender: ProposalSender,
  operation: string,
  rowId: string,
) =>
  sender.senderType === "AGENCY"
    ? sender.senderId
    : requirePublicId(sender.senderAccountId, operation, rowId);

export const toProposalResponse = (
  proposal: ProposalRow,
  senderAccountId: string | null | undefined,
  operation: string,
) => ({
  id: proposal.id,
  jobId: proposal.job_id,
  senderId: toProposalSenderId(
    {
      senderId: proposal.sender_id,
      senderType: proposal.sender_type,
      senderAccountId,
    },
    operation,
    proposal.id,
  ),
  senderType: proposal.sender_type,
  coverLetter: proposal.cover_letter,
  bidAmountCents: proposal.bid_amount_cents,
  duration: proposal.duration,
  screeningAnswers: proposal.screening_answers,
  status: proposal.status,
  isShortlisted: proposal.is_shortlisted,
  createdAt: proposal.created_at,
  updatedAt: proposal.updated_at,
});

export const toProposalInterviewResponse = (result: {
  conversationId: string;
  proposalId: string;
  senderType: string;
  freelancerAccountId: string;
  agencyId: string | null;
  jobTitle: string;
  connects: number;
}) => ({
  conversationId: result.conversationId,
  proposalId: result.proposalId,
  senderType: result.senderType,
  freelancerId: result.freelancerAccountId,
  agencyId: result.agencyId,
  jobTitle: result.jobTitle,
  connects: result.connects,
});
