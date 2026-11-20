import type { Metadata } from "next";
import { PageHeader } from "../_components/admin-shell";
import { AdminIcon } from "../_components/admin-icon";
import { formatDateTime, unwrap } from "@onemarketplace/api-client";
import { ApiErrorBanner, Pagination } from "../_components/ui";
import { fetchAdmin } from "../_components/fetch-admin";
import { overviewVolumeView } from "../../lib/money-views";
import { parseOffset } from "../../lib/labels";

export const metadata: Metadata = { title: "Overview" };

const PAGE_SIZE = 10;

export default async function OverviewPage({
  searchParams,
}: {
  searchParams: Promise<{ offset?: string }>;
}) {
  const offset = parseOffset((await searchParams).offset);
  const currentPath = `/?offset=${offset}`;
  const [{ data, error }, activity] = await Promise.all([
    fetchAdmin(currentPath, (api) => unwrap(api.GET("/api/v1/admin/overview"))),
    fetchAdmin(currentPath, (api) =>
      unwrap(
        api.GET("/api/v1/admin/overview/activity", {
          params: { query: { limit: PAGE_SIZE, offset } },
        }),
      ),
    ),
  ]);
  const recentActivity = activity.data?.results ?? [];
  const volume = data ? overviewVolumeView(data.volume) : null;

  return (
    <>
      <PageHeader
        eyebrow="Platform command center"
        title="Marketplace overview"
        description="Live counts and recent activity across every side of OneMarketplace.io."
      />

      {(error ?? activity.error) && (
        <ApiErrorBanner error={error ?? activity.error} />
      )}

      {data && volume && (
        <section className="mt-8 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <Metric
            icon="users"
            label="Freelancers"
            value={data.totals.freelancers}
          />
          <Metric icon="users" label="Clients" value={data.totals.clients} />
          <Metric icon="users" label="Agencies" value={data.totals.agencies} />
          <Metric icon="jobs" label="Job posts" value={data.totals.jobPosts} />
          <Metric
            icon="proposal"
            label="Proposals"
            value={data.totals.proposals}
          />
          <Metric
            icon="contract"
            label="Contracts"
            value={data.totals.contracts}
            detail={`${data.totals.activeContracts} active`}
          />
          <Metric
            icon="wallet"
            label="Total contract value"
            value={volume.totalContractValue}
          />
          <Metric
            icon="wallet"
            label="Paid out"
            value={volume.totalPaidOut}
            detail={`${volume.connectsRevenue} Connects revenue`}
          />
        </section>
      )}

      <section className="mt-5 overflow-hidden rounded-2xl border border-black/8 bg-white">
        <header className="border-b border-black/7 p-5">
          <h2 className="font-semibold">Recent activity</h2>
          <p className="mt-1 text-xs text-[#7c8179]">
            Latest accounts, agencies, job posts, and contracts — newest first
          </p>
        </header>
        <div>
          {recentActivity.map((item, index) => (
            <div
              key={`${item.type}-${item.id}`}
              className={`flex items-center gap-3 px-5 py-3.5 ${index ? "border-t border-black/6" : ""}`}
            >
              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-[#f1f3ef] text-[#52784f]">
                <AdminIcon name="trend" size={14} />
              </span>
              <div className="min-w-0 flex-1">
                <p className="truncate text-xs font-semibold">{item.title}</p>
                <p className="mt-0.5 text-[10px] text-[#858a82]">{item.type}</p>
              </div>
              <span className="shrink-0 text-[10px] text-[#969b94]">
                {formatDateTime(item.createdAt)}
              </span>
            </div>
          ))}
          {!recentActivity.length && (
            <div className="p-10 text-center text-sm text-[#7c8179]">
              No activity yet.
            </div>
          )}
        </div>
        <Pagination
          offset={offset}
          limit={PAGE_SIZE}
          count={recentActivity.length}
          hasMore={activity.data?.hasMore ?? false}
          basePath="/"
        />
      </section>
    </>
  );
}

function Metric({
  icon,
  label,
  value,
  detail,
}: {
  icon: "users" | "jobs" | "proposal" | "contract" | "wallet";
  label: string;
  value: string | number;
  detail?: string;
}) {
  return (
    <article className="rounded-2xl border border-black/8 bg-white p-5">
      <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-[#edf4ea] text-[#52784f]">
        <AdminIcon name={icon} size={20} />
      </span>
      <p className="mt-5 text-2xl font-semibold tracking-[-.04em]">{value}</p>
      <h2 className="mt-1 text-xs font-semibold">{label}</h2>
      {detail && <p className="mt-2 text-[10px] text-[#858a82]">{detail}</p>}
    </article>
  );
}
