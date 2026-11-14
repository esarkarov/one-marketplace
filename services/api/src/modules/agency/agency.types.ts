import { type StoredImage } from "../../shared/uploads/portfolio-images.js";

export interface AgencyPortfolioItem {
  id: string;
  title: string;
  category: string;
  description: string;
  liveUrl: string | null;
  coverImage: StoredImage;
}

export interface AgencyMember {
  id: string;
  freelancerId: string;
  profileId: string | null;
  name: string;
  avatarUrl: string | null;
  role: string;
  skills: string[];
  isOwner: boolean;
  rating: number;
  jobSuccessScore: number;
  completedProjects: number;
}

export interface AgencyWorkHistoryItem {
  id: string;
  title: string;
  client: string;
  status: "ACTIVE" | "COMPLETED";
  completed: Date | null;
  amountCents: number;
  rating: number | null;
  review: string | null;
  clientHasReviewed: boolean;
  freelancerHasReviewed: boolean;
}

export interface AgencyStats {
  totalEarningCents: number;
  completedJobs: number;
  ongoingJobs: number;
  reviewCount: number;
  jobSuccessScore: number;
  rating: number | null;
}

export interface AgencyData {
  id: string;
  name: string;
  professionalTitle: string | null;
  size: string;
  specialty: string;
  website: string | null;
  overview: string;
  tags: string[];
  avatarImage: StoredImage | null;
  isOnboarded: boolean;
  portfolio: AgencyPortfolioItem[];
  ownerLocation: string | null;
  ownerLanguages: string[];
  ownerLanguageDetails: Array<{ language: string; proficiency: string }>;
  members: AgencyMember[];
  createdAt: Date | null;
  stats: AgencyStats;
  workHistory: AgencyWorkHistoryItem[];
}

export interface CreateAgencyInput {
  ownerId: string;
  name: string;
  size: string;
  specialty: string;
  website?: string;
  overview: string;
}

export interface ImageInput {
  url: string;
}

export interface UpdateAgencyPortfolioInput {
  title: string;
  category: string;
  description: string;
  liveUrl?: string;
  coverImage: ImageInput;
}

export interface UpdateAgencyInput {
  ownerId: string;
  name: string;
  professionalTitle: string;
  size: string;
  specialty: string;
  website?: string;
  overview: string;
  tags: string[];
  avatarImage?: ImageInput;
  portfolio: UpdateAgencyPortfolioInput[];
}
