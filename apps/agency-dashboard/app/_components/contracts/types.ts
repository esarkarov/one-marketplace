export type AgencyMilestoneStatus = "Paid" | "In progress" | "Upcoming";
export type AgencyContractStatus =
  | "Pending"
  | "Active"
  | "Awaiting feedback"
  | "Completed";

export type AgencyMilestone = {
  id: string;
  title: string;
  amount: string;
  due: string;
  status: AgencyMilestoneStatus;
  paymentRequestedAt?: string | null;
};

export type AgencyContract = {
  id: string;
  conversationId?: string | null;
  title: string;
  client: string;
  clientInitials: string;
  clientAvatar?: string | null;
  clientLocation: string;
  status: AgencyContractStatus;
  started: string;
  totalBudget: string;
  earned: string;
  escrow: string;
  nextDeadline: string;
  progress: number;
  currentMilestone: string;
  currentMilestoneId?: string;
  description: string;
  milestones: AgencyMilestone[];
  reviewedByCurrentUser?: boolean;
};
