import type {
  FreelancerProfileData,
  FreelancerProfileRecord,
  StoredPortfolio,
} from "../types/freelancer.types.js";

export const toFreelancerPortfolioResponse = (portfolio: StoredPortfolio) => ({
  id: portfolio.id,
  freelancerId: portfolio.freelancer_id,
  title: portfolio.title,
  category: portfolio.category,
  description: portfolio.description,
  liveUrl: portfolio.live_url,
  coverImage: portfolio.cover_image,
  createdAt: portfolio.created_at,
  updatedAt: portfolio.updated_at,
});

export const toFreelancerProfileSavedResponse = (
  profile: FreelancerProfileData,
) => ({
  professionalTitle: profile.professional_title,
  professionalDescription: profile.professional_description,
  hourlyRateCents: profile.hourly_rate_cents,
  country: profile.country,
  city: profile.city,
  availabilityStatus: profile.availability_status,
  weeklyAvailability: profile.weekly_availability,
  experienceLevel: profile.experience_level,
  skills: profile.skills,
  languages: profile.languages,
  portfolios: profile.portfolios.map(toFreelancerPortfolioResponse),
  identityVerified: profile.identityVerified,
  joinedAt: profile.joined_at,
});

export const toFreelancerProfileResponse = (
  profile: FreelancerProfileRecord,
) => ({
  id: profile.id,
  createdAt: profile.created_at,
  updatedAt: profile.updated_at,
  ...toFreelancerProfileSavedResponse(profile),
  agency: profile.agency,
  stats: profile.stats,
  workHistory: profile.workHistory?.map(({ created_at, ...item }) => ({
    ...item,
    createdAt: created_at,
  })),
});
