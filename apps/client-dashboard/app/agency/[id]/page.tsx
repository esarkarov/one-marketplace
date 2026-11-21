import type { Metadata } from "next";
import { ClientHeader } from "../../_components/dashboard/client-header";
import { AgencyProfileView } from "../../_components/profiles/profile-views";

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

  return (
    <div className="min-h-svh bg-[#f4f6f2] text-[#242724]">
      <ClientHeader />
      <main className="mx-auto max-w-360 px-5 py-8 sm:px-8 lg:py-10">
        <AgencyProfileView id={id} />
      </main>
    </div>
  );
}
