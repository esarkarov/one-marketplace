export type MilestoneStatus = "Paid" | "In progress" | "Upcoming";
export type ContractStatus =
  | "Pending"
  | "Active"
  | "Awaiting feedback"
  | "Completed";

export type Milestone = {
  id: number | string;
  title: string;
  amount: string;
  due: string;
  status: MilestoneStatus;
  paymentRequestedAt?: string | null;
};

export type Contract = {
  id: number | string;
  conversationId?: string | null;
  title: string;
  client: string;
  clientInitials: string;
  clientAvatar?: string | null;
  clientLocation: string;
  status: ContractStatus;
  started: string;
  totalBudget: string;
  earned: string;
  funded: string;
  nextDeadline: string;
  progress: number;
  currentMilestone: string;
  currentMilestoneId?: string;
  description: string;
  milestones: Milestone[];
  reviewedByCurrentUser?: boolean;
};
