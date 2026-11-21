import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { ClientShell } from "../_components/dashboard/client-shell";
import { ProposalsDashboard } from "../_components/proposals/proposals-dashboard";
import { Suspense } from "react";

export const metadata: Metadata = {
  title: "Proposals",
  description:
    "Review, shortlist, interview, and hire freelancers or agencies.",
};

const JOB_ID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function ProposalsPage({
  searchParams,
}: {
  searchParams: Promise<{ job?: string | string[] }>;
}) {
  const { job } = await searchParams;
  if (typeof job === "string" && JOB_ID.test(job)) {
    redirect(`/proposals/${job}`);
  }

  return (
    <Suspense>
      <ClientShell>
        <ProposalsDashboard />
      </ClientShell>
    </Suspense>
  );
}
