import type { Metadata } from "next";
import { AgencyHeader } from "../_components/dashboard/agency-header";
import { AgencyProfileView } from "../_components/profile/agency-profile-view";
import { Suspense } from "react";

export const metadata: Metadata = {
  title: "Agency Profile | OneMarketplace.io",
  description:
    "Preview your agency's public profile, specialists, work, and client reviews.",
};

export default function AgencyProfilePage() {
  return (
    <Suspense>
      <div className="min-h-svh bg-[#f4f6f2] text-[#242724]">
        <AgencyHeader />
        <main className="mx-auto max-w-360 px-5 py-8 sm:px-8 lg:py-10">
          <AgencyProfileView />
        </main>
      </div>
    </Suspense>
  );
}
