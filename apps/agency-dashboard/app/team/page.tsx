import type { Metadata } from "next";
import { TeamDashboard } from "./team-dashboard";
import { Suspense } from "react";

export const metadata: Metadata = {
  title: "Agency Team | OneMarketplace.io",
  description:
    "Manage agency membership, freelancer profiles, roles, and account permissions.",
};

export default function AgencyTeamPage() {
  return (
    <Suspense>
      <TeamDashboard />
    </Suspense>
  );
}
