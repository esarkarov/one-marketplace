import { ClientShell } from "@/app/_components/dashboard/client-shell";
import { ProposalsDashboard } from "@/app/_components/proposals/proposals-dashboard";
import React from "react";

export default async function JobProposalsPage({
  params,
}: {
  params: Promise<{ jobId: string }>;
}) {
  const { jobId } = await params;

  return (
    <ClientShell>
      <ProposalsDashboard initialJobId={jobId} />
    </ClientShell>
  );
}
