import type { MarketplaceAccountType } from "@/modules/client/constants/client.constants.js";
export interface SaveClientProfileInput {
  userId: string;
  professionalRole: string;
  companyName: string;
  companyWebsite: string;
  companySize: string;
  industry: string;
  companyDescription: string;
  country?: string | null;
}

export interface ClientMetadataData {
  professionalRole: string;
  companyName: string;
  companyWebsite: string;
  companySize: string;
  industry: string;
  companyDescription: string;
  country: string | null;
  joinedAt: Date | null;
  identityVerified: boolean;
  paymentMethodVerified: boolean;
}

export interface ClientProfileData extends ClientMetadataData {
  isOnboarded: true;
}

export interface ClientHiringOverview {
  totalSpentCents: number;
  completedContracts: number;
  rating: number;
  openJobs: number;
  totalHires: number;
  hireRate: number;
  averageResponseDays: number | null;
}

export interface ClientDashboardOverview {
  openJobs: number;
  totalProposals: number;
  newProposals: number;
  shortlistedProposals: number;
  activeContracts: number;
  totalContracts: number;
  totalSpentCents: number;
  currentlyFundedCents: number;
  inProgressContracts: Array<{
    id: string;
    title: string;
    progressPercent: number;
  }>;
  activeJobPosts: Array<{
    id: string;
    title: string;
    budgetCents: number;
    level: string;
    duration: string;
    proposalCount: number;
  }>;
}

export interface ClientCompletedContract {
  id: string;
  title: string;
  talent: string;
  budgetCents: number;
  completedAt: string | null;
  clientReview: { rating: number; text: string } | null;
  talentReview: { rating: number; text: string } | null;
}

export interface MarketplaceSearchResult {
  id: string;
  accountType: MarketplaceAccountType;
  name: string;
  title: string;
  location: string;
  verified: boolean;
  skills: string[];
  jobSuccess: number;
  rating: number;
  avatarUrl: string | null;
}

export interface MarketplaceSearchPage {
  results: MarketplaceSearchResult[];
  hasMore: boolean;
}
