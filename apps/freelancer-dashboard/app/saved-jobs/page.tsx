import type { Metadata } from "next";
import { SavedJobsDashboard } from "./saved-jobs-dashboard";
import { Suspense } from "react";

export const metadata: Metadata = {
  title: "Saved Jobs | OneMarketplace.io",
  description: "Review and manage your saved freelance opportunities.",
};

export default function SavedJobsPage() {
  return (
    <Suspense>
      <SavedJobsDashboard />
    </Suspense>
  );
}
