import type { Metadata } from "next";
import { Suspense } from "react";
import { FreelancerDashboard } from "./freelancer-dashboard";

export const metadata: Metadata = {
  title: "Freelancer Dashboard | OneMarketplace.io",
  description:
    "Discover matching projects, manage proposals, and grow your freelance business.",
};

export default function MainDashboardPage() {
  return (
    <Suspense>
      <FreelancerDashboard />
    </Suspense>
  );
}
