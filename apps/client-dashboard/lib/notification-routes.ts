import type { NotificationCategory } from "../app/_components/notifications/types";

export interface NotificationRoute {
  category: NotificationCategory;
  base: string | null;
}

const CONTRACTS = { category: "Contracts", base: "/contracts" } as const;
const PROPOSALS = { category: "Proposals", base: "/proposals" } as const;
const NO_ROUTE_ACCOUNT = { category: "Account", base: null } as const;

export const NOTIFICATION_ROUTES: Readonly<Record<string, NotificationRoute>> =
  {
    CONTRACT_OFFER: CONTRACTS,
    CONTRACT_ACCEPTED: CONTRACTS,
    CONTRACT_DECLINED: CONTRACTS,
    CONTRACT_WITHDRAWN: CONTRACTS,
    CONTRACT_COMPLETED: CONTRACTS,
    MILESTONE_ADDED: CONTRACTS,
    MILESTONE_SUBMITTED: CONTRACTS,
    MILESTONE_APPROVED: CONTRACTS,
    MILESTONE_CHANGES_REQUESTED: CONTRACTS,
    MILESTONE_FUNDED: { category: "Payments", base: "/contracts" },
    PAYOUT_COMPLETED: { category: "Payments", base: null },
    PROPOSAL_RECEIVED: PROPOSALS,
    PROPOSAL_VIEWED: PROPOSALS,
    PROPOSAL_INTERVIEWED: { category: "Proposals", base: "/messages" },
    AGENCY_INVITATION: NO_ROUTE_ACCOUNT,
    AGENCY_WELCOME_BONUS: NO_ROUTE_ACCOUNT,
    REVIEW_RECEIVED: NO_ROUTE_ACCOUNT,
  };

export const notificationCategory = (type: string): NotificationCategory =>
  NOTIFICATION_ROUTES[type]?.category ?? "Account";

const internalTarget = (
  link: string | null | undefined,
): { pathname: string; search: string } | null => {
  if (!link || !link.startsWith("/") || link.startsWith("//")) return null;
  try {
    const url = new URL(link, "http://client.invalid");
    if (url.origin !== "http://client.invalid") return null;
    return { pathname: url.pathname, search: url.search };
  } catch {
    return null;
  }
};

export const notificationHref = (
  type: string,
  link?: string | null,
): string | null => {
  const base = NOTIFICATION_ROUTES[type]?.base ?? null;
  if (!base) return null;
  const target = internalTarget(link);
  if (
    target &&
    (target.pathname === base || target.pathname.startsWith(`${base}/`))
  ) {
    return `${target.pathname}${target.search}`;
  }
  return base;
};
