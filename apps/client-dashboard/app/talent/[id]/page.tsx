import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ClientHeader } from "../../_components/dashboard/client-header";
import { ClientProposal } from "../../_components/data/client-data";
import { PublicMarketplaceProfile } from "../../_components/profiles/public-marketplace-profile";
import { auth } from "@clerk/nextjs/server";
import { countries } from "@/utils/countries";

export const metadata: Metadata = {
  title: "Talent Profile",
  description: "Review a freelancer’s public marketplace profile and work.",
};

export default async function TalentProfilePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const { getToken } = await auth();
  const token = await getToken();

  const response = await fetch(
    `${process.env.NEXT_PUBLIC_SERVER_URI}/freelancer/profile/${id}`,
    {
      headers: { Authorization: `Bearer ${token}` },
      cache: "no-store",
    },
  );
  if (!response.ok) notFound();
  const { data } = await response.json();
  const workHistory = Array.isArray(data.workHistory) ? data.workHistory : [];

  const profile: ClientProposal = {
    id,
    freelancerId: id,
    jobId: "",
    bidder: data.name,
    avatarUrl: data.avatarUrl,
    initials: data.name
      .split(" ")
      .map((part: string) => part[0])
      .join("")
      .slice(0, 2),
    accountType: "Freelancer",
    title: data.professional_title,
    location: `${data.city}, ${countries.find(({ code }) => code === data.country)?.name ?? data.country}`,
    verified: data.identityVerified,
    online: false,
    rating: Number(data.stats?.rating ?? 0),
    jobSuccess: Number(data.stats?.jobSuccessScore ?? 0),
    completedProjects:
      workHistory.length ||
      Number(data.stats?.completedJobs ?? 0) +
        Number(data.stats?.ongoingJobs ?? 0),
    bid: Number(data.hourly_rate),
    duration: data.weekly_availability,
    submitted: "",
    coverLetter: data.professional_description,
    skills: data.skills,
    portfolios: data.portfolios,
    languages: data.languages,
    agency: data.agency,
    workHistory,
    milestonePlan: [],
    status: "New",
  };

  return (
    <div className="min-h-svh bg-[#f4f6f2] text-[#242724]">
      <ClientHeader />
      <main className="mx-auto max-w-360 px-5 py-8 sm:px-8 lg:py-10">
        <PublicMarketplaceProfile profile={profile} />
      </main>
    </div>
  );
}
