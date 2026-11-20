"use client";

import { Icon } from "@iconify/react";
import { useQuery } from "@tanstack/react-query";
import { useAuth, useUser } from "@clerk/nextjs";
import type { SettingsSectionId } from "./settings-data";

type FinanceOverviewProps = {
  onOpenSection: (section: SettingsSectionId) => void;
  onBuyConnects: () => void;
  onWithdraw: () => void;
  onDownloadStatement: () => void;
};

const formatCurrency = (value: number) =>
  `$${value.toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;

export function FinanceOverview({
  onOpenSection,
  onBuyConnects,
  onWithdraw,
  onDownloadStatement,
}: FinanceOverviewProps) {
  const { user } = useUser();
  const { getToken } = useAuth();

  const { data: profile } = useQuery({
    queryKey: ["profile-metadata"],
    enabled: Boolean(user),
    queryFn: async () => {
      const token = await getToken();
      const response = await fetch(
        `${process.env.NEXT_PUBLIC_SERVER_URI}/freelancer/profile?role=freelancer`,
        {
          headers: { Authorization: `Bearer ${token}` },
          cache: "no-store",
        },
      );
      const result = await response.json();
      if (!response.ok) {
        throw new Error(result.message || "Your profile could not be loaded.");
      }
      return result.data;
    },
  });

  const { data: connectsMetadata } = useQuery({
    queryKey: ["connects"],
    enabled: Boolean(user),
    queryFn: async () => {
      const token = await getToken();
      const response = await fetch(
        `${process.env.NEXT_PUBLIC_SERVER_URI}/connects?role=freelancer`,
        {
          headers: { Authorization: `Bearer ${token}` },
          cache: "no-store",
        },
      );
      const result = await response.json();
      if (!response.ok) {
        throw new Error(
          result.message || "Your Connects balance could not be loaded.",
        );
      }
      return result.data;
    },
  });

  const { data: earnings } = useQuery({
    queryKey: ["freelancer-earnings-overview"],
    enabled: Boolean(user),
    queryFn: async () => {
      const token = await getToken();
      const response = await fetch(
        `${process.env.NEXT_PUBLIC_SERVER_URI}/freelancer/earnings/overview?role=freelancer`,
        {
          headers: { Authorization: `Bearer ${token}` },
          cache: "no-store",
        },
      );
      const result = await response.json();
      if (!response.ok) {
        throw new Error(result.message || "Your earnings could not be loaded.");
      }
      return result.data as {
        available: number;
        pending: number;
        lifetime: number;
      };
    },
  });

  const { data: earningsSummary } = useQuery({
    queryKey: ["freelancer-earnings-summary"],
    enabled: Boolean(user),
    queryFn: async () => {
      const token = await getToken();
      const response = await fetch(
        `${process.env.NEXT_PUBLIC_SERVER_URI}/freelancer/earnings/summary?role=freelancer`,
        {
          headers: { Authorization: `Bearer ${token}` },
          cache: "no-store",
        },
      );
      const result = await response.json();
      if (!response.ok) {
        throw new Error(
          result.message || "Your earnings summary could not be loaded.",
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
  const identityVerified = Boolean(profile?.identityVerified);

  return (
    <div className="grid gap-5">
      <section className="grid gap-4 md:grid-cols-3">
        <article className="rounded-2xl bg-[#252724] p-5 text-white">
          <div className="flex items-start justify-between">
            <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-white/10 text-[#a8c5a1]">
              <Icon icon="solar:wallet-money-linear" width="21" />
            </span>
            <span className="text-[11px] text-white/55">Available</span>
          </div>
          <p className="mt-6 text-3xl font-semibold tracking-[-0.045em]">
            {earnings ? formatCurrency(earnings.available) : "..."}
          </p>
          <p className="mt-1 text-xs text-white/60">
            {earnings
              ? `${formatCurrency(earnings.pending)} pending clearance`
              : "Loading..."}
          </p>
          <button
            type="button"
            onClick={onWithdraw}
            className="mt-5 h-10 w-full cursor-pointer rounded-xl bg-white text-xs font-semibold text-[#252724]"
          >
            Withdraw earnings
          </button>
        </article>

        <article className="rounded-2xl border border-black/8 bg-white p-5">
          <div className="flex items-start justify-between">
            <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-[#eeeaf5] text-[#6b5d82]">
              <Icon icon="solar:bolt-linear" width="21" />
            </span>
            <button
              type="button"
              onClick={() => onOpenSection("connects")}
              className="cursor-pointer text-[11px] font-semibold text-[#52784f] hover:underline"
            >
              View history
            </button>
          </div>
          <p className="mt-6 text-3xl font-semibold tracking-[-0.045em]">
            {connectsMetadata?.connects ?? "..."}
          </p>
          <p className="mt-1 text-xs text-[#7b8078]">Connects available</p>
          <button
            type="button"
            onClick={onBuyConnects}
            className="mt-5 h-10 w-full cursor-pointer rounded-xl border border-black/10 text-xs font-semibold hover:bg-black/3"
          >
            Buy Connects
          </button>
        </article>

        <article className="rounded-2xl border border-black/8 bg-white p-5">
          <div className="flex items-start justify-between">
            <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-[#e7f2e4] text-[#4d784a]">
              <Icon icon="solar:chart-2-linear" width="21" />
            </span>
            <button
              type="button"
              onClick={() => onOpenSection("earnings")}
              className="cursor-pointer text-[11px] font-semibold text-[#52784f] hover:underline"
            >
              View report
            </button>
          </div>
          <p className="mt-6 text-3xl font-semibold tracking-[-0.045em]">
            {earnings ? formatCurrency(earnings.lifetime) : "..."}
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

      <section className="rounded-2xl border border-black/8 bg-white p-5 sm:p-6">
        <div>
          <h2 className="font-semibold">Quick actions</h2>
          <p className="mt-1 text-xs text-[#7b8078]">
            Jump straight to the things you manage most.
          </p>
        </div>
        <div className="mt-5 grid gap-3 sm:grid-cols-3">
          <button
            type="button"
            onClick={() => onOpenSection("verification")}
            className="flex cursor-pointer items-center gap-3 rounded-xl border border-black/7 p-4 text-left hover:bg-[#f8f9f6]"
          >
            <Icon
              icon="solar:user-id-linear"
              width="20"
              className="shrink-0 text-[#597b56]"
            />
            <span className="min-w-0 flex-1">
              <strong className="block text-xs">Identity verification</strong>
              <span className="mt-1 block truncate text-[11px] text-[#858a82]">
                {identityVerified ? "Verified" : "Not verified yet"}
              </span>
            </span>
            <Icon icon="solar:alt-arrow-right-linear" width="15" />
          </button>
          <button
            type="button"
            onClick={() => onOpenSection("withdrawal")}
            className="flex cursor-pointer items-center gap-3 rounded-xl border border-black/7 p-4 text-left hover:bg-[#f8f9f6]"
          >
            <Icon
              icon="solar:card-transfer-linear"
              width="20"
              className="shrink-0 text-[#597b56]"
            />
            <span className="min-w-0 flex-1">
              <strong className="block text-xs">Withdrawal methods</strong>
              <span className="mt-1 block truncate text-[11px] text-[#858a82]">
                Manage payouts on Stripe
              </span>
            </span>
            <Icon icon="solar:alt-arrow-right-linear" width="15" />
          </button>
          {!!earnings?.lifetime && (
            <button
              type="button"
              onClick={onDownloadStatement}
              className="flex cursor-pointer items-center gap-3 rounded-xl border border-black/7 p-4 text-left hover:bg-[#f8f9f6]"
            >
              <Icon
                icon="solar:document-text-linear"
                width="20"
                className="shrink-0 text-[#597b56]"
              />
              <span className="min-w-0 flex-1">
                <strong className="block text-xs">Earnings certificate</strong>
                <span className="mt-1 block truncate text-[11px] text-[#858a82]">
                  Download a signed PDF
                </span>
              </span>
              <Icon icon="solar:alt-arrow-right-linear" width="15" />
            </button>
          )}
        </div>
      </section>
    </div>
  );
}
