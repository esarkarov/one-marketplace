import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { auth } from "@clerk/nextjs/server";
import { ClientHeader } from "../../_components/dashboard/client-header";
import { PublicAgencyProfile } from "../../_components/profiles/public-agency-profile";

export const metadata: Metadata = {
  title: "Agency Profile",
  description: "Review an agency’s public marketplace profile, team, and work.",
};

export default async function AgencyProfilePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const { getToken } = await auth();
  const token = await getToken();

  const response = await fetch(
    `${process.env.NEXT_PUBLIC_SERVER_URI}/agency/profile/${id}`,
    {
      headers: { Authorization: `Bearer ${token}` },
      cache: "no-store",
    },
  );
  if (!response.ok) notFound();
  const { data } = await response.json();

  return (
    <div className="min-h-svh bg-[#f4f6f2] text-[#242724]">
      <ClientHeader />
      <main className="mx-auto max-w-360 px-5 py-8 sm:px-8 lg:py-10">
        <PublicAgencyProfile agency={data} />
      </main>
    </div>
  );
}
