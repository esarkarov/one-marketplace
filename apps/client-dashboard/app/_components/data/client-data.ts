export type JobStatus = "Open" | "Draft" | "Closed";

export type ClientJob = {
  id: number;
  title: string;
  status: JobStatus;
  posted: string;
  budget: number;
  level: "Entry level" | "Intermediate" | "Expert";
  duration: string;
  description: string;
  skills: string[];
  proposals: number;
  shortlisted: number;
  hires: number;
  visibility: "Marketplace";
  screeningQuestions: string[];
  milestones: { id: number; title: string; amount: number; due: string }[];
};

export type ClientProposal = {
  id: number | string;
  contractId?: string | null;
  backendStatus?: "SUBMITTED" | "VIEWED" | "INTERVIEWED" | "HIRED";
  conversationId?: string | null;
  freelancerId?: string;
  senderId?: string;
  memberCount?: number;
  jobId: number | string;
  bidder: string;
  avatarUrl?: string | null;
  initials: string;
  accountType: "Freelancer" | "Agency";
  title: string;
  location: string;
  verified: boolean;
  online: boolean;
  rating: number;
  jobSuccess: number;
  completedProjects: number;
  bid: number;
  duration: string;
  submitted: string;
  coverLetter: string;
  skills: string[];
  milestonePlan: { title: string; amount: number; duration: string }[];
  screeningAnswers?: { question: string; answer: string }[];
  portfolios?: Array<{
    title: string;
    category: string;
    description: string;
    live_url: string | null;
    cover_image: { imageId: string; url: string };
  }>;
  languages?: Array<{ language: string; proficiency: string }>;
  agency?: { id: string; name: string; avatarUrl: string | null } | null;
  workHistory?: Array<{
    id: string;
    title: string;
    client: string;
    status: "ACTIVE" | "COMPLETED";
    completed: string | null;
    created_at: string | null;
    amount: number;
    rating: number | null;
    review: string | null;
    clientHasReviewed: boolean;
    freelancerHasReviewed: boolean;
  }>;
  status:
    | "New"
    | "Shortlisted"
    | "Interview"
    | "Offer sent"
    | "Rejected"
    | "Hired";
};

export type ClientContract = {
  id: number | string;
  title: string;
  talent: string;
  initials: string;
  accountType: "Freelancer" | "Agency";
  status: "Active" | "Awaiting approval" | "Completed";
  started: string;
  totalBudget: number;
  paid: number;
  escrow: number;
  progress: number;
  nextDeadline: string;
  description: string;
  reviewedByCurrentUser?: boolean;
  milestones: {
    id: number | string;
    title: string;
    amount: number;
    due: string;
    status: "Paid" | "In progress" | "Upcoming" | "Submitted";
    submissionComment?: string;
    clientRequirements?: string;
  }[];
};

export type CompletedClientContract = {
  id: number;
  title: string;
  talent: string;
  accountType: "Freelancer" | "Agency";
  completed: string;
  budget: number;
  clientReview?: {
    rating: number;
    text: string;
  };
  talentReview?: {
    rating: number;
    text: string;
  };
};

export type ClientConversation = {
  id: number | string;
  person: string;
  initials: string;
  avatarUrl?: string | null;
  accountType: "Freelancer" | "Agency";
  context: string;
  contextHref: string;
  contextLabel: string;
  online: boolean;
  unread: number;
  lastMessage: string;
  time: string;
  messages: ClientMessage[];
  activeMeeting: { id: string; joinUrl: string; startedAt: string } | null;
};

export type ClientMessage =
  | {
      id: number | string;
      kind: "text";
      sender: "client" | "talent";
      text: string;
      time: string;
      replyToId?: number | string;
      attachment?: {
        name: string;
        size: string;
        type: string;
        url?: string;
      };
    }
  | {
      id: number | string;
      kind: "proposal";
      sender: "talent";
      title: string;
      bid: number;
      duration: string;
      summary: string;
      skills: string[];
      href: string;
      time: string;
    }
  | {
      id: number | string;
      kind: "meeting";
      sender: "client" | "talent";
      title: string;
      startsAt: string;
      meetUrl: string;
      ended: boolean;
      time: string;
    }
  | {
      id: number | string;
      kind: "meeting_ended";
      durationMinutes: number;
      time: string;
    }
  | {
      id: number | string;
      kind: "contract";
      sender: "client";
      title: string;
      amount: number;
      status: "Awaiting acceptance" | "Active" | "Completed";
      href: string;
      time: string;
    }
  | {
      id: number | string;
      kind: "contract_completed";
      sender: "system" | "client" | "talent";
      title: string;
      href: string;
      time: string;
      contractId?: string;
    }
  | {
      id: number | string;
      kind: "milestone";
      sender: "client" | "talent";
      title: string;
      amount: number;
      status:
        | "Added"
        | "Funded"
        | "Submitted"
        | "Changes requested"
        | "Approved";
      href: string;
      time: string;
      contractId?: string;
      milestoneId?: string;
      submissionMessage?: string;
      submissionDeliveryLink?: string;
      dueDate?: string;
    }
  | {
      id: number | string;
      kind: "payment";
      sender: "system";
      title: string;
      amount: number;
      status: "Protected in escrow" | "Released";
      time: string;
    };
