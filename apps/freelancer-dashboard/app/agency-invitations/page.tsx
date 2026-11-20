import type { Metadata } from "next";
import { Suspense } from "react";
import { AgencyInvitationsDashboard } from "./agency-invitations-dashboard";

export const metadata: Metadata = {
  title: "Agency Invitations | OneMarketplace.io",
  description: "Review and respond to invitations to join an agency team.",
};

export default function AgencyInvitationsPage() {
  return (
    <Suspense>
      <AgencyInvitationsDashboard />
    </Suspense>
  );
}
