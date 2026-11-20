export type AgencyProposalStatus =
  | "Interview"
  | "Viewed"
  | "Submitted"
  | "Archived";

export type AgencyProposal = {
  id: string;
  jobId: string;
  title: string;
  client: string;
  status: AgencyProposalStatus;
  submitted: string;
  clientBudget: string;
  agencyBid: string;
  duration: string;
  connects: number;
  clientRating: string;
  clientSpent: string;
  activity: string;
  coverLetter: string;
  skills: string[];
  conversationId: string | null;
};
