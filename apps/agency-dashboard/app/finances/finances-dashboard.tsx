"use client";

import { useAuth, useUser } from "@clerk/nextjs";
import { useQuery } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { AgencyShell } from "../_components/dashboard/agency-shell";
import {
  financeSections,
  type FinanceSection,
} from "../_components/finances/finance-data";
import { FinanceModal } from "../_components/finances/finance-modal";
import { FinanceNavigation } from "../_components/finances/finance-navigation";
import { Icon } from "../_components/ui/icon";

const validSections: FinanceSection[] = [
  "overview",
  "earnings",
  "withdrawals",
  "connects",
];

type AgencyEarningItem = {
  id: string;
  title: string;
  client: string;
  amount: number;
  date: string;
  status: "AVAILABLE" | "PENDING" | "WITHDRAWN";
};

type AgencyEarningsOverview = {
  available: number;
  pending: number;
  lifetime: number;
  totalFees: number;
  recentEarnings: AgencyEarningItem[];
};

const formatCurrency = (value: number) =>
  `$${value.toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;

export function FinancesDashboard({
  initialSection,
}: {
  initialSection?: string;
}) {
  const [section, setSection] = useState<FinanceSection>(
    validSections.includes(initialSection as FinanceSection)
      ? (initialSection as FinanceSection)
      : "overview",
  );
  const [connectsModalOpen, setConnectsModalOpen] = useState(false);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [redirecting, setRedirecting] = useState(false);
  const router = useRouter();
  const { user } = useUser();
  const { getToken } = useAuth();

  const openSection = (next: FinanceSection) => {
    setSection(next);
    router.push(`/finances?section=${next}`, { scroll: false });
  };

  const { data: agency } = useQuery({
    queryKey: ["agency-mine"],
    enabled: Boolean(user),
    queryFn: async () => {
      const token = await getToken();
      const response = await fetch(
        `${process.env.NEXT_PUBLIC_SERVER_URI}/agency/mine?role=freelancer`,
        { headers: { Authorization: `Bearer ${token}` }, cache: "no-store" },
      );
      const result = await response.json();
      if (!response.ok) throw new Error(result.message);
      return result.data as { name: string } | null;
    },
  });

  const { data: connectsBalance } = useQuery({
    queryKey: ["agency-connects"],
    enabled: Boolean(user),
    queryFn: async () => {
      const token = await getToken();
      const response = await fetch(
        `${process.env.NEXT_PUBLIC_SERVER_URI}/agency/connects?role=freelancer`,
        { headers: { Authorization: `Bearer ${token}` }, cache: "no-store" },
      );
      const result = await response.json();
      if (!response.ok) {
        throw new Error(result.message || "Agency Connects could not be loaded.");
      }
      return result.data as { connects: number };
    },
  });

  const { data: connectsHistory = [] } = useQuery({
    queryKey: ["agency-connects-history"],
    enabled: Boolean(user),
    queryFn: async () => {
      const token = await getToken();
      const response = await fetch(
        `${process.env.NEXT_PUBLIC_SERVER_URI}/agency/connects/history?role=freelancer`,
        { headers: { Authorization: `Bearer ${token}` }, cache: "no-store" },
      );
      const result = await response.json();
      if (!response.ok) {
        throw new Error(result.message || "Connects history could not be loaded.");
      }
      return result.data as {
        id: string;
        type: string;
        description: string;
        amount: number;
        created_at: string;
      }[];
    },
  });

  const { data: overview } = useQuery({
    queryKey: ["agency-earnings-overview"],
    enabled: Boolean(user),
    queryFn: async () => {
      const token = await getToken();
      const response = await fetch(
        `${process.env.NEXT_PUBLIC_SERVER_URI}/agency/earnings/overview?role=freelancer`,
        { headers: { Authorization: `Bearer ${token}` }, cache: "no-store" },
      );
      const result = await response.json();
      if (!response.ok) {
        throw new Error(result.message || "Agency earnings could not be loaded.");
      }
      return result.data as AgencyEarningsOverview;
    },
  });

  const { data: earningsSummary } = useQuery({
    queryKey: ["agency-earnings-summary"],
    enabled: Boolean(user),
    queryFn: async () => {
      const token = await getToken();
      const response = await fetch(
        `${process.env.NEXT_PUBLIC_SERVER_URI}/agency/earnings/summary?role=freelancer`,
        { headers: { Authorization: `Bearer ${token}` }, cache: "no-store" },
      );
      const result = await response.json();
      if (!response.ok) {
        throw new Error(
          result.message || "The earnings summary could not be loaded.",
        );
      }
      return result.data as {
        hasEarnings: boolean;
        currentMonthTotal: number;
        previousMonthTotal: number;
        series: Array<{ month: string; total: number }>;
      };
    },
  });

  const series = earningsSummary?.series ?? [];
  const chartMax = Math.max(...series.map((item) => item.total), 1);

  const connectsUsedThisMonth = useMemo(() => {
    const now = new Date();
    return connectsHistory.reduce((total, item) => {
      const date = new Date(item.created_at);
      const sameMonth =
        date.getMonth() === now.getMonth() &&
        date.getFullYear() === now.getFullYear();
      return sameMonth && item.amount < 0 ? total + Math.abs(item.amount) : total;
    }, 0);
  }, [connectsHistory]);

  const recentEarnings = overview?.recentEarnings ?? [];
  const filteredEarnings = useMemo(() => {
    const query = search.trim().toLowerCase();
    return recentEarnings.filter(
      (item) =>
        !query || `${item.title} ${item.client}`.toLowerCase().includes(query),
    );
  }, [recentEarnings, search]);

  const manageOnStripe = async () => {
    setRedirecting(true);
    setError("");
    try {
      const token = await getToken();
      const response = await fetch(
        `${process.env.NEXT_PUBLIC_SERVER_URI}/agency/payouts/connect-link?role=freelancer`,
        { headers: { Authorization: `Bearer ${token}` } },
      );
      const result = await response.json();
      if (!response.ok || !result.data?.url) {
        throw new Error(result.message || "Stripe could not be opened right now.");
      }
      window.location.assign(result.data.url);
    } catch (caughtError) {
      setError(
        caughtError instanceof Error
          ? caughtError.message
          : "Stripe could not be opened right now.",
      );
      setRedirecting(false);
    }
  };

  return (
    <AgencyShell>
      <div>
        <p className="text-xs font-semibold tracking-[0.14em] text-[#62805f] uppercase">
          Agency finances
        </p>
        <h1 className="mt-2 text-3xl font-semibold tracking-[-0.045em] sm:text-4xl">
          Earnings & finances
        </h1>
        <p className="mt-2 text-sm text-[#72776f]">
          Manage client payments, Agency Connects, and withdrawals.
        </p>
      </div>

      <div className="mt-8 grid items-start gap-5 lg:grid-cols-[230px_minmax(0,1fr)]">
        <div className="lg:sticky lg:top-24">
          <FinanceNavigation active={section} onChange={openSection} />
        </div>
        <div className="min-w-0">
          {section === "overview" && (
            <div className="grid gap-5">
              <section className="grid gap-4 md:grid-cols-3">
                <article className="rounded-2xl bg-[#252724] p-5 text-white">
                  <div className="flex items-start justify-between">
                    <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-white/10 text-[#a8c5a1]">
                      <Icon name="wallet" size={21} />
                    </span>
                    <span className="text-[11px] text-white/55">Available</span>
                  </div>
                  <p className="mt-6 text-3xl font-semibold tracking-[-0.045em]">
                    {overview ? formatCurrency(overview.available) : "..."}
                  </p>
                  <p className="mt-1 text-xs text-white/60">
                    {overview
                      ? `${formatCurrency(overview.pending)} pending clearance`
                      : "Loading..."}
                  </p>
                  <button
                    type="button"
                    onClick={() => void manageOnStripe()}
                    disabled={redirecting || !overview || overview.available <= 0}
                    className="mt-5 h-10 w-full cursor-pointer rounded-xl bg-white text-xs font-semibold text-[#252724] disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {redirecting
                      ? "Redirecting..."
                      : overview && overview.available <= 0
                        ? "Nothing to withdraw yet"
                        : "Withdraw earnings"}
                  </button>
                </article>
                <article className="rounded-2xl border border-black/8 bg-white p-5">
                  <div className="flex items-start justify-between">
                    <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-[#eeeaf5] text-[#6b5d82]">
                      <Icon name="proposal" size={21} />
                    </span>
                    <button
                      type="button"
                      onClick={() => openSection("connects")}
                      className="cursor-pointer text-[11px] font-semibold text-[#52784f] hover:underline"
                    >
                      View history
                    </button>
                  </div>
                  <p className="mt-6 text-3xl font-semibold tracking-[-0.045em]">
                    {connectsBalance?.connects ?? "..."}
                  </p>
                  <p className="mt-1 text-xs text-[#7b8078]">
                    {connectsUsedThisMonth
                      ? `${connectsUsedThisMonth} used this month`
                      : "No usage yet this month"}
                  </p>
                  <button
                    type="button"
                    onClick={() => setConnectsModalOpen(true)}
                    className="mt-5 h-10 w-full cursor-pointer rounded-xl border border-black/10 text-xs font-semibold hover:bg-black/3"
                  >
                    Buy Connects
                  </button>
                </article>
                <article className="rounded-2xl border border-black/8 bg-white p-5">
                  <div className="flex items-start justify-between">
                    <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-[#e7f2e4] text-[#4d784a]">
                      <Icon name="chart" size={21} />
                    </span>
                    <button
                      type="button"
                      onClick={() => openSection("earnings")}
                      className="cursor-pointer text-[11px] font-semibold text-[#52784f] hover:underline"
                    >
                      View report
                    </button>
                  </div>
                  <p className="mt-6 text-3xl font-semibold tracking-[-0.045em]">
                    {overview ? formatCurrency(overview.lifetime) : "..."}
                  </p>
                  <p className="mt-1 text-xs text-[#7b8078]">Lifetime earnings</p>
                  <div className="mt-5 flex h-10 items-end gap-1.5">
                    {series.length ? (
                      series.map((item) => (
                        <span
                          key={item.month}
                          className="flex-1 rounded-t bg-[#8ba487]"
                          style={{
                            height: `${Math.max(4, Math.round((item.total / chartMax) * 100))}%`,
                          }}
                        />
                      ))
                    ) : (
                      <span className="w-full text-center text-[11px] text-[#a3a89e]">
                        No earnings yet
                      </span>
                    )}
                  </div>
                </article>
              </section>
              <section className="overflow-hidden rounded-2xl border border-black/8 bg-white">
                <PanelHeader
                  title="Recent agency earnings"
                  description={`Milestone payments received by ${agency?.name ?? "your agency"}`}
                  action="View all"
                  onAction={() => openSection("earnings")}
                />
                <EarningsRows items={recentEarnings.slice(0, 3)} />
              </section>
            </div>
          )}

          {section === "earnings" && (
            <section className="overflow-hidden rounded-2xl border border-black/8 bg-white">
              <PanelHeader
                title="Agency earnings"
                description="Payments earned through agency contracts"
              />
              <div className="grid gap-3 border-b border-black/7 p-5 sm:grid-cols-3">
                {[
                  ["Available", overview?.available],
                  ["Pending", overview?.pending],
                  ["Lifetime", overview?.lifetime],
                ].map(([label, value]) => (
                  <div key={label as string} className="rounded-xl bg-[#f3f5f1] p-4">
                    <p className="text-[11px] text-[#7b8078]">{label}</p>
                    <p className="mt-1 text-xl font-semibold">
                      {typeof value === "number" ? formatCurrency(value) : "..."}
                    </p>
                  </div>
                ))}
              </div>
              <div className="border-b border-black/7 p-4">
                <label className="flex h-10 items-center gap-2 rounded-xl border border-black/9 px-3 sm:w-72">
                  <Icon name="search" size={17} />
                  <input
                    value={search}
                    onChange={(event) => setSearch(event.target.value)}
                    placeholder="Search earnings"
                    className="min-w-0 flex-1 bg-transparent text-sm outline-none"
                  />
                </label>
              </div>
              {overview && !filteredEarnings.length ? (
                <p className="px-5 py-10 text-center text-xs text-[#8a8f87] sm:px-6">
                  No earnings yet.
                </p>
              ) : (
                <EarningsRows items={filteredEarnings} />
              )}
            </section>
          )}

          {section === "withdrawals" && (
            <section className="overflow-hidden rounded-2xl border border-black/8 bg-white">
              <PanelHeader
                title="Withdrawals"
                description="Manage where the agency's available earnings are sent through Stripe."
              />
              <div className="grid gap-4 p-5 sm:p-6">
                <article className="flex flex-col justify-between gap-4 rounded-2xl border border-black/8 bg-[#f8f9f6] p-5 sm:flex-row sm:items-center">
                  <div className="flex items-center gap-4">
                    <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-white text-[#52784f]">
                      <Icon name="wallet" size={23} />
                    </span>
                    <div>
                      <h3 className="text-sm font-semibold">Payout account</h3>
                      <p className="mt-1 text-xs text-[#7b8078]">
                        Add the agency&apos;s bank details, view payouts, and
                        manage how the agency gets paid on Stripe.
                      </p>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => void manageOnStripe()}
                    disabled={redirecting}
                    className="h-10 cursor-pointer rounded-xl bg-[#252724] px-4 text-xs font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {redirecting ? "Redirecting..." : "Manage on Stripe"}
                  </button>
                </article>
                {error && <p className="text-xs text-red-600">{error}</p>}
                <p className="rounded-xl bg-[#fbeceb] px-4 py-3 text-xs leading-5 text-[#a4453d]">
                  Payouts are currently only available for agencies whose owner
                  is based in the United States, United Kingdom, Canada,
                  Switzerland, and the European Economic Area (EEA). Support
                  for more countries is coming soon — earnings stay safely on
                  the agency balance until then.
                </p>
              </div>
            </section>
          )}

          {section === "connects" && (
            <section className="overflow-hidden rounded-2xl border border-black/8 bg-white">
              <PanelHeader
                title="Agency Connects"
                description="Track proposal credits owned by the agency"
                action="Buy Connects"
                onAction={() => setConnectsModalOpen(true)}
              />
              <div className="border-b border-black/7 p-5 sm:p-6">
                <p className="text-xs text-[#7b8078]">Available balance</p>
                <p className="mt-1 text-3xl font-semibold">
                  {connectsBalance?.connects ?? 0}{" "}
                  <span className="text-sm font-normal text-[#7b8078]">
                    Agency Connects
                  </span>
                </p>
              </div>
              {connectsHistory.length === 0 && (
                <p className="px-5 py-10 text-center text-xs text-[#8a8f87] sm:px-6">
                  No Connects activity yet.
                </p>
              )}
              {connectsHistory.map((item, index) => (
                <div
                  key={item.id}
                  className={`flex items-center gap-4 px-5 py-4 sm:px-6 ${
                    index ? "border-t border-black/6" : ""
                  }`}
                >
                  <span
                    className={`flex h-9 w-9 items-center justify-center rounded-full ${
                      item.amount > 0
                        ? "bg-[#e7f2e4] text-[#4d784a]"
                        : "bg-[#f1f0e7] text-[#766f47]"
                    }`}
                  >
                    <Icon name="proposal" size={18} />
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-semibold">{item.type}</p>
                    <p className="mt-1 truncate text-xs text-[#858a82]">
                      {item.description} ·{" "}
                      {new Date(item.created_at).toLocaleDateString()}
                    </p>
                  </div>
                  <strong
                    className={`text-sm ${
                      item.amount > 0 ? "text-[#4d784a]" : ""
                    }`}
                  >
                    {item.amount > 0 ? "+" : ""}
                    {item.amount}
                  </strong>
                </div>
              ))}
            </section>
          )}

        </div>
      </div>

      {connectsModalOpen && (
        <FinanceModal onClose={() => setConnectsModalOpen(false)} />
      )}
    </AgencyShell>
  );
}

function PanelHeader({
  title,
  description,
  action,
  onAction,
}: {
  title: string;
  description: string;
  action?: string;
  onAction?: () => void;
}) {
  return (
    <header className="flex items-center justify-between gap-4 border-b border-black/7 px-5 py-5 sm:px-6">
      <div>
        <h2 className="text-lg font-semibold">{title}</h2>
        <p className="mt-1 text-xs text-[#7b8078]">{description}</p>
      </div>
      {action && (
        <button
          type="button"
          onClick={onAction}
          className="shrink-0 text-xs font-semibold text-[#52784f] hover:underline"
        >
          {action}
        </button>
      )}
    </header>
  );
}

function EarningsRows({ items }: { items: AgencyEarningItem[] }) {
  return (
    <div>
      {items.map((item, index) => (
        <div
          key={item.id}
          className={`flex items-center gap-4 px-5 py-4 sm:px-6 ${
            index ? "border-t border-black/6" : ""
          }`}
        >
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-semibold">{item.title}</p>
            <p className="mt-1 truncate text-xs text-[#858a82]">
              {item.client} · {new Date(item.date).toLocaleDateString()}
            </p>
          </div>
          <div className="text-right">
            <p className="text-sm font-semibold">{formatCurrency(item.amount)}</p>
            <p
              className={`mt-1 text-[10px] ${
                item.status === "AVAILABLE"
                  ? "text-[#52784f]"
                  : item.status === "WITHDRAWN"
                    ? "text-[#7b8078]"
                    : "text-[#8a7a3a]"
              }`}
            >
              {item.status === "AVAILABLE"
                ? "Available"
                : item.status === "WITHDRAWN"
                  ? "Withdrawn"
                  : "Pending"}
            </p>
          </div>
        </div>
      ))}
    </div>
  );
}
