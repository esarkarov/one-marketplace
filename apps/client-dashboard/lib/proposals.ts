import type { Components } from "@onemarketplace/api-client";
import { errorMessage, isApiError } from "@onemarketplace/api-client";

export type ProposalListItem =
  | Components["schemas"]["ProposalsClientItem"]
  | Components["schemas"]["ProposalsFreelancerItem"];
export type ClientProposalItem = Components["schemas"]["ProposalsClientItem"];
export type ProposalApiStatus = ClientProposalItem["status"];
export type ProposalScreeningAnswer =
  ClientProposalItem["screeningAnswers"][number];

export const PROPOSALS_PAGE_SIZE = 10;

const KNOWN_STATUS_LABELS = {
  SUBMITTED: "New",
  VIEWED: "Viewed",
  INTERVIEWED: "Interview",
  HIRED: "Hired",
} satisfies Record<ProposalApiStatus, string>;

const STATUS_LABELS: Readonly<Record<string, string>> = KNOWN_STATUS_LABELS;

export const proposalStatusLabel = (status: string): string =>
  Object.hasOwn(STATUS_LABELS, status)
    ? (STATUS_LABELS[status] ?? status)
    : status;

export const SHORTLISTED_FILTER = "Shortlisted";

export const PROPOSAL_FILTERS = [
  "All",
  KNOWN_STATUS_LABELS.SUBMITTED,
  KNOWN_STATUS_LABELS.VIEWED,
  SHORTLISTED_FILTER,
  KNOWN_STATUS_LABELS.INTERVIEWED,
  KNOWN_STATUS_LABELS.HIRED,
] as const;

export interface ProposalView {
  id: string;
  status: string;
  statusLabel: string;
  isShortlisted: boolean;
  bidder: string;
  initials: string;
  avatarUrl: string | null;
  accountType: "Agency" | "Freelancer";
  title: string;
  location: string;
  verified: boolean;
  rating: number;
  jobSuccess: number;
  completedProjects: number;
  bidCents: number;
  duration: string;
  submittedAt: string | null;
  coverLetter: string;
  skills: string[];
  screeningAnswers: ProposalScreeningAnswer[];
  conversationId: string | null;
  contractId: string | null;
  senderId: string;
  profileId: string | null;
}

export const isClientProposalItem = (
  item: ProposalListItem,
): item is ClientProposalItem => "senderId" in item && "bidAmountCents" in item;

export const isAgencySender = (senderType: string): boolean =>
  senderType === "AGENCY";

export const initialsOf = (name: string): string =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .map((part) => Array.from(part)[0] ?? "")
    .join("")
    .slice(0, 2)
    .toUpperCase();

export const formatLocation = (
  city: string | null,
  country: string | null,
  countryName: (code: string) => string | undefined,
): string => {
  const place = country ? (countryName(country) ?? country) : null;
  return [city, place].filter(Boolean).join(", ") || "Location unavailable";
};

export const agencyTitle = (memberCount: number): string =>
  `Agency · ${memberCount} member${memberCount === 1 ? "" : "s"}`;

export const toProposalView = (
  item: ClientProposalItem,
  countryName: (code: string) => string | undefined = () => undefined,
): ProposalView => {
  const agency = isAgencySender(item.senderType);
  const bidder = item.senderName ?? (agency ? "Agency" : "Freelancer");
  const avatarUrl = "avatar" in item ? item.avatar : null;
  const memberCount = "memberCount" in item ? item.memberCount : 0;

  return {
    id: item.id,
    status: item.status,
    statusLabel: proposalStatusLabel(item.status),
    isShortlisted: item.isShortlisted,
    bidder,
    initials: initialsOf(bidder),
    avatarUrl,
    accountType: agency ? "Agency" : "Freelancer",
    title: agency
      ? agencyTitle(memberCount)
      : (item.professionalTitle ?? "Freelancer"),
    location: formatLocation(item.city, item.country, countryName),
    verified: item.verified ?? false,
    rating: item.rating,
    jobSuccess: item.jobSuccessScore,
    completedProjects: item.completedJobs,
    bidCents: item.bidAmountCents,
    duration: item.duration,
    submittedAt: item.submittedAt,
    coverLetter: item.coverLetter,
    skills: item.skills ?? [],
    screeningAnswers: item.screeningAnswers,
    conversationId: item.conversationId,
    contractId: item.contractId,
    senderId: item.senderId,
    profileId: item.profileId,
  };
};

export const toProposalViews = (
  items: readonly ProposalListItem[],
  countryName?: (code: string) => string | undefined,
): ProposalView[] =>
  items
    .filter(isClientProposalItem)
    .map((item) => toProposalView(item, countryName));

export const matchesFilter = (
  proposal: Pick<ProposalView, "statusLabel" | "isShortlisted">,
  filter: string,
): boolean => {
  if (filter === "All") return true;
  if (filter === SHORTLISTED_FILTER) return proposal.isShortlisted;
  return proposal.statusLabel === filter;
};

export const countByFilter = (
  proposals: readonly Pick<ProposalView, "statusLabel" | "isShortlisted">[],
  filter: string,
): number => proposals.filter((item) => matchesFilter(item, filter)).length;

export const profileHref = (
  proposal: Pick<ProposalView, "accountType" | "senderId" | "profileId">,
): string | null => {
  if (proposal.accountType === "Agency") {
    return `/agency/${encodeURIComponent(proposal.senderId)}`;
  }
  return proposal.profileId
    ? `/talent/${encodeURIComponent(proposal.profileId)}`
    : null;
};

export const canStartInterview = (
  proposal: Pick<ProposalView, "status" | "conversationId">,
): boolean => proposal.status !== "HIRED" || proposal.conversationId !== null;

export const hasInterview = (
  proposal: Pick<ProposalView, "status" | "conversationId">,
): boolean =>
  proposal.conversationId !== null &&
  (proposal.status === "INTERVIEWED" || proposal.status === "HIRED");

export const canSendOffer = (
  proposal: Pick<ProposalView, "status" | "contractId">,
): boolean => proposal.contractId === null && proposal.status !== "HIRED";

export const messagesHref = (conversationId: string): string =>
  `/messages?conversationId=${encodeURIComponent(conversationId)}`;

export const INTERVIEW_MESSAGE_MAX = 5000;

export const proposalErrorMessage = (error: unknown): string => {
  const message = errorMessage(error);
  return isApiError(error) && error.requestId
    ? `${message} (reference ${error.requestId})`
    : message;
};
