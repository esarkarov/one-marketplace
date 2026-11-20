import { Suspense } from "react";
import { AgencyJobFeed } from "./_components/jobs/agency-job-feed";

export default function AgencyDashboardPage() {
  return (
    <Suspense>
      <AgencyJobFeed />
    </Suspense>
  );
}
