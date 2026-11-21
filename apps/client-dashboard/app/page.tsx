"use client";
import { Icon } from "@iconify/react";
import Link from "next/link";
import { ClientShell } from "./_components/dashboard/client-shell";
import { useUser } from "@clerk/nextjs";
import { formatCents } from "@onemarketplace/api-client";
import { profileErrorMessage } from "@onemarketplace/web-core";
import { Suspense } from "react";
import { useDashboardOverview } from "@/app/hooks/use-profiles";
import { formatCompactCents } from "@/lib/client-profile";

export default function ClientDashboardPage() {
  const { user, isLoaded } = useUser();

  const { data: overview, error } = useDashboardOverview(Boolean(user));

  return (
    <Suspense>
      <ClientShell>
        <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
          <div>
            <p className="text-xs font-semibold tracking-[.14em] text-[#62805f] uppercase">
              Client workspace
            </p>
            <h1 className="mt-2 text-3xl font-semibold tracking-[-.045em] sm:text-4xl">
              Good morning, {!isLoaded ? "..." : user?.firstName}.
            </h1>
            <p className="mt-2 text-sm text-[#72776f]">
              Keep hiring and delivery moving without the busywork.
            </p>
          </div>
          <Link
            href="/jobs/new"
            className="inline-flex h-11 items-center justify-center gap-2 rounded-xl bg-[#252724] px-5 text-sm font-semibold text-white"
          >
            <Icon icon="solar:add-circle-linear" width="18" /> Post a job
          </Link>
        </div>
        {error && (
          <p
            role="alert"
            className="mt-6 rounded-xl border border-[#e3c4c4] bg-[#fbf1f1] p-4 text-sm text-[#8b4a4a]"
          >
            {profileErrorMessage(error)}
          </p>
        )}
        <section className="mt-8 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <Metric
            icon="solar:document-text-linear"
            label="Open job posts"
            value={overview ? String(overview.openJobs) : "..."}
            detail={
              overview ? `${overview.totalProposals} total proposals` : "..."
            }
          />
          <Metric
            icon="solar:users-group-rounded-linear"
            label="New proposals"
            value={overview ? String(overview.newProposals) : "..."}
            detail={
              overview ? `${overview.shortlistedProposals} shortlisted` : "..."
            }
          />
          <Metric
            icon="solar:case-round-linear"
            label="Active contracts"
            value={overview ? String(overview.activeContracts) : "..."}
            detail={
              overview
                ? `${formatCompactCents(overview.currentlyFundedCents)} currently funded`
                : "..."
            }
          />
          <Metric
            icon="solar:wallet-money-linear"
            label="Total spent"
            value={
              overview ? formatCompactCents(overview.totalSpentCents) : "..."
            }
            detail={
              overview ? `Across ${overview.totalContracts} contracts` : "..."
            }
          />
        </section>
        <div className="mt-6 grid gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
          <section className="overflow-hidden rounded-2xl border border-black/8 bg-white">
            <header className="flex items-center justify-between border-b border-black/7 p-5 sm:p-6">
              <div>
                <h2 className="font-semibold">Active job posts</h2>
                <p className="mt-1 text-xs text-[#7b8078]">
                  Review proposals and keep hiring moving.
                </p>
              </div>
              <Link
                href="/jobs"
                className="text-xs font-semibold text-[#52784f]"
              >
                View all
              </Link>
            </header>
            {overview && overview.activeJobPosts.length === 0 ? (
              <p className="px-5 py-10 text-center text-sm text-[#858a82] sm:px-6">
                No open job posts yet.
              </p>
            ) : (
              (overview?.activeJobPosts ?? []).map((job, index) => (
                <div
                  key={job.id}
                  className={`p-5 sm:p-6 ${index ? "border-t border-black/6" : ""}`}
                >
                  <div className="flex flex-wrap justify-between gap-3">
                    <div>
                      <h3 className="text-sm font-semibold">{job.title}</h3>
                      <p className="mt-2 text-xs text-[#7b8078]">
                        Fixed price · {formatCents(job.budgetCents)} ·{" "}
                        {job.level} · {job.duration}
                      </p>
                    </div>
                    <Link
                      href={`/proposals?job=${encodeURIComponent(job.id)}`}
                      className="h-9 rounded-lg border border-black/10 px-3 py-2 text-xs font-semibold"
                    >
                      {job.proposalCount} proposals
                    </Link>
                  </div>
                </div>
              ))
            )}
          </section>
          <section className="rounded-2xl bg-[#252a25] p-6 text-white">
            <p className="text-xs text-white/55">Currently in progress</p>
            <p className="mt-2 text-3xl font-semibold">
              {overview ? formatCents(overview.currentlyFundedCents) : "..."}
            </p>
            <div className="mt-6 space-y-4">
              {(overview?.inProgressContracts ?? []).map((contract) => (
                <div key={contract.id}>
                  <div className="flex justify-between gap-3 text-xs">
                    <span>{contract.title}</span>
                    <span className="text-white/60">
                      {contract.progressPercent}%
                    </span>
                  </div>
                  <div className="mt-2 h-1.5 rounded-full bg-white/10">
                    <div
                      style={{ width: `${contract.progressPercent}%` }}
                      className="h-full rounded-full bg-[#8aa486]"
                    />
                  </div>
                </div>
              ))}
              {overview && overview.inProgressContracts.length === 0 && (
                <p className="text-xs text-white/50">
                  No contracts in progress right now.
                </p>
              )}
            </div>
            <Link
              href="/contracts"
              className="mt-7 inline-flex text-xs font-semibold text-[#a8c5a1]"
            >
              Manage contracts →
            </Link>
          </section>
        </div>
      </ClientShell>
    </Suspense>
  );
}

function Metric({
  icon,
  label,
  value,
  detail,
}: {
  icon: string;
  label: string;
  value: string;
  detail: string;
}) {
  return (
    <article className="rounded-2xl border border-black/8 bg-white p-5">
      <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-[#edf4ea] text-[#52784f]">
        <Icon icon={icon} width="20" />
      </span>
      <p className="mt-5 text-2xl font-semibold">{value}</p>
      <h2 className="mt-1 text-xs font-semibold">{label}</h2>
      <p className="mt-1 text-[10px] text-[#858a82]">{detail}</p>
    </article>
  );
}
