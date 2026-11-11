interface LanguageData {
  language: string;
  proficiency: string;
}

export interface PortfolioData {
  title: string;
  category: string;
  description: string;
  live_url: string | null;
  cover_image: { imageId: string; url: string };
}

export interface FreelancerProfileData {
  professional_title: string;
  professional_description: string;
  hourly_rate_cents: number;
  country: string;
  city: string;
  availability_status: string;
  weekly_availability: string;
  experience_level: string;
  skills: string[];
  languages: LanguageData[];
  portfolios: PortfolioData[];
  identityVerified: boolean;
  joined_at: Date | null;
  agency?: { id: string; name: string; avatarUrl: string | null } | null;
  stats?: {
    totalEarningCents: number;
    completedJobs: number;
    ongoingJobs: number;
    reviewCount: number;
    jobSuccessScore: number;
    rating: number | null;
  };
  workHistory?: Array<{
    id: string;
    title: string;
    client: string;
    status: "ACTIVE" | "COMPLETED";
    completed: Date | string | null;
    created_at: Date | string;
    amountCents: number;
    rating: number | null;
    review: string | null;
    clientHasReviewed: boolean;
    freelancerHasReviewed: boolean;
    skills: string[];
  }>;
}

export interface SaveFreelancerProfileInput {
  userId: string;
  professional_title: string;
  professional_description: string;
  hourly_rate_cents: number;
  country: string;
  city: string;
  availability_status: string;
  weekly_availability: string;
  experience_level: string;
  skills: string[];
  languages: LanguageData[];
  portfolios: PortfolioData[];
}
