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

export const toProposalResponse = (proposal: ProposalRow) => ({
  id: proposal.id,
  jobId: proposal.job_id,
  senderId: proposal.sender_id,
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
