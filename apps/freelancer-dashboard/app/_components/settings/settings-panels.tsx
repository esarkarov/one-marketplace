"use client";

import { Icon } from "@iconify/react";
import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useAuth, useReverification, useSession, useUser } from "@clerk/nextjs";
import type {
  SessionWithActivitiesResource,
  TOTPResource,
} from "@clerk/shared/types";
import { format } from "timeago.js";

const extractClerkError = (error: unknown): string => {
  if (error && typeof error === "object" && "errors" in error) {
    const errors = (
      error as { errors?: Array<{ longMessage?: string; message?: string }> }
    ).errors;
    if (errors?.[0]) {
      return (
        errors[0].longMessage || errors[0].message || "Something went wrong."
      );
    }
  }
  return error instanceof Error ? error.message : "Something went wrong.";
};

const inputClass =
  "mt-2 h-11 w-full rounded-xl border border-black/10 px-3 text-sm font-normal outline-none focus:border-[#6e916a]";

const Panel = ({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children: React.ReactNode;
}) => (
  <section className="overflow-hidden rounded-2xl border border-black/8 bg-white">
    <header className="border-b border-black/7 px-5 py-5 sm:px-6">
      <h2 className="text-lg font-semibold">{title}</h2>
      <p className="mt-1 text-xs text-[#7b8078]">{description}</p>
    </header>
    {children}
  </section>
);

const ConnectsHistorySkeleton = () => (
  <div aria-label="Loading Connects history" role="status">
    {Array.from({ length: 4 }).map((_, index) => (
      <div
        key={index}
        className={`flex animate-pulse items-center gap-4 px-5 py-4 sm:px-6 ${index ? "border-t border-black/6" : ""}`}
      >
        <span className="h-9 w-9 shrink-0 rounded-full bg-[#e9ece6]" />
        <div className="min-w-0 flex-1">
          <div className="h-3.5 w-36 rounded-full bg-[#e4e7e1]" />
          <div className="mt-2 h-3 w-52 max-w-full rounded-full bg-[#eef0ec]" />
        </div>
        <span className="h-3.5 w-8 rounded-full bg-[#e4e7e1]" />
      </div>
    ))}
  </div>
);

export function ConnectsPanel({ onBuy }: { onBuy: () => void }) {
  const { user } = useUser();
  const { getToken } = useAuth();

  const { data: connectsMetadata, isLoading: connectsMetadataLoading } =
    useQuery({
      queryKey: ["connects"],
      enabled: Boolean(user),
      queryFn: async () => {
        const token = await getToken();

        const response = await fetch(
          `${process.env.NEXT_PUBLIC_SERVER_URI}/connects?role=freelancer`,
          {
            headers: {
              Authorization: `Bearer ${token}`,
            },
            cache: "no-store",
          },
        );

        const result = await response.json();

        if (!response.ok) {
          throw new Error(
            result.message || "The client profile could not be loaded.",
          );
        }

        return result.data;
      },
    });

  const { data: connectsHistory, isLoading: connectsHistoryLoading } = useQuery(
    {
      queryKey: ["connects-history"],
      enabled: Boolean(user),
      queryFn: async () => {
        const token = await getToken();

        const response = await fetch(
          `${process.env.NEXT_PUBLIC_SERVER_URI}/connects/history?role=freelancer`,
          {
            headers: {
              Authorization: `Bearer ${token}`,
            },
            cache: "no-store",
          },
        );

        const result = await response.json();

        if (!response.ok) {
          throw new Error(
            result.message || "The client profile could not be loaded.",
          );
        }

        return result.data;
      },
    },
  );

  return (
    <Panel
      title="Connects"
      description="Track how you use Connects and purchase more when you need them."
    >
      <div className="flex flex-col justify-between gap-4 border-b border-black/7 p-5 sm:flex-row sm:items-center sm:p-6">
        <div>
          <p className="text-xs text-[#7b8078]">Available balance</p>
          <p className="mt-1 text-3xl font-semibold">
            {connectsMetadata?.connects || "..."}{" "}
            <span className="text-sm font-normal text-[#7b8078]">Connects</span>
          </p>
        </div>
        <button
          type="button"
          onClick={onBuy}
          className="h-11 cursor-pointer rounded-xl bg-[#252724] px-5 text-sm font-semibold text-white"
        >
          Buy Connects
        </button>
      </div>

      <div>
        {connectsHistoryLoading || connectsMetadataLoading ? (
          <ConnectsHistorySkeleton />
        ) : (
          <div>
            {connectsHistory?.map((item: any, index: number) => (
              <div
                key={item.id}
                className={`flex items-center gap-4 px-5 py-4 sm:px-6 ${index ? "border-t border-black/6" : ""}`}
              >
                <span
                  className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full ${item.amount > 0 ? "bg-[#e7f2e4] text-[#4d784a]" : "bg-[#f1f0e7] text-[#766f47]"}`}
                >
                  <Icon
                    icon={
                      item.amount > 0
                        ? "solar:add-circle-linear"
                        : "solar:plain-2-linear"
                    }
                    width="18"
                  />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold">{item.type}</p>
                  <p className="mt-1 truncate text-xs text-[#858a82]">
                    {item.description} · {format(item.created_at)}
                  </p>
                </div>
                <strong
                  className={`text-sm ${item.amount > 0 ? "text-[#4d784a]" : "text-[#343833]"}`}
                >
                  {item.amount > 0 ? "+" : ""}
                  {item.amount}
                </strong>
              </div>
            ))}
          </div>
        )}
      </div>
    </Panel>
  );
}

const EarningsHistorySkeleton = () => (
  <div aria-label="Loading recent earnings" role="status">
    {Array.from({ length: 4 }).map((_, index) => (
      <div
        key={index}
        className={`flex animate-pulse items-center gap-4 px-5 py-4 sm:px-6 ${index ? "border-t border-black/6" : ""}`}
      >
        <div className="min-w-0 flex-1">
          <div className="h-3.5 w-40 rounded-full bg-[#e4e7e1]" />
          <div className="mt-2 h-3 w-56 max-w-full rounded-full bg-[#eef0ec]" />
        </div>
        <div className="text-right">
          <div className="ml-auto h-3.5 w-14 rounded-full bg-[#e4e7e1]" />
          <div className="mt-2 ml-auto h-3 w-10 rounded-full bg-[#eef0ec]" />
        </div>
      </div>
    ))}
  </div>
);

const formatCurrency = (value: number) =>
  `$${value.toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;

const formatAvailableIn = (availableAt: string) => {
  const diffDays = Math.ceil(
    (new Date(availableAt).getTime() - Date.now()) / (24 * 60 * 60 * 1000),
  );
  if (diffDays <= 0) return "Available now";
  if (diffDays === 1) return "Available in 1 day";
  return `Available in ${diffDays} days`;
};

function StatTile({
  label,
  value,
  tooltip,
}: {
  label: string;
  value: string;
  tooltip?: string;
}) {
  return (
    <div className="rounded-xl bg-[#f3f5f1] p-4">
      <p className="flex items-center gap-1.5 text-[11px] text-[#7b8078]">
        {label}
        {tooltip && (
          <span className="group relative inline-flex">
            <button
              type="button"
              aria-label={`${label} info`}
              className="flex h-4 w-4 cursor-help items-center justify-center rounded-full border border-[#789075] text-[10px] font-bold text-[#52784f]"
            >
              ?
            </button>
            <span className="pointer-events-none absolute left-0 bottom-6 z-20 hidden w-56 rounded-xl bg-[#252724] p-3 text-left text-[11px] leading-5 font-normal text-white shadow-xl group-hover:block group-focus-within:block">
              {tooltip}
            </span>
          </span>
        )}
      </p>
      <p className="mt-1 text-xl font-semibold">{value}</p>
    </div>
  );
}

export function EarningsPanel({
  onWithdraw,
  onDownloadStatement,
}: {
  onWithdraw: () => void;
  onDownloadStatement: () => void;
}) {
  const { user } = useUser();
  const { getToken } = useAuth();

  const { data: earnings, isLoading: earningsLoading } = useQuery({
    queryKey: ["freelancer-earnings-overview"],
    enabled: Boolean(user),
    queryFn: async () => {
      const token = await getToken();

      const response = await fetch(
        `${process.env.NEXT_PUBLIC_SERVER_URI}/freelancer/earnings/overview?role=freelancer`,
        {
          headers: {
            Authorization: `Bearer ${token}`,
          },
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
        totalFees: number;
        feeRatePercent: number;
        recentEarnings: Array<{
          id: string;
          title: string;
          client: string;
          grossAmount: number;
          platformFeeAmount: number;
          amount: number;
          date: string;
          availableAt: string;
          status: "AVAILABLE" | "PENDING" | "WITHDRAWN";
        }>;
      };
    },
  });

  return (
    <Panel
      title="Earnings"
      description="Review payments from milestones and track when funds become available."
    >
      <div className="grid gap-3 border-b border-black/7 p-5 sm:grid-cols-2 sm:p-6 lg:grid-cols-4">
        <StatTile
          label="Available"
          value={earnings ? formatCurrency(earnings.available) : "..."}
        />
        <StatTile
          label="Pending"
          value={earnings ? formatCurrency(earnings.pending) : "..."}
          tooltip="For security, every approved milestone payment becomes available to withdraw 5 days after the client approves it."
        />
        <StatTile
          label="Lifetime earnings"
          value={earnings ? formatCurrency(earnings.lifetime) : "..."}
        />
        <StatTile
          label={`Platform fees${earnings ? ` (${earnings.feeRatePercent}%)` : ""}`}
          value={earnings ? `-${formatCurrency(earnings.totalFees)}` : "..."}
        />
      </div>
      <div className="flex flex-col gap-3 px-5 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-6">
        <h3 className="text-sm font-semibold">Recent earnings</h3>
        <div className="flex flex-wrap items-center gap-3">
          {!!earnings?.lifetime && (
            <>
              <button
                type="button"
                onClick={onDownloadStatement}
                className="inline-flex cursor-pointer items-center gap-1.5 text-xs font-semibold text-[#52784f] hover:underline"
              >
                <Icon icon="solar:download-minimalistic-linear" width="15" />{" "}
                Download earnings statement
              </button>
              <button
                type="button"
                onClick={onWithdraw}
                className="cursor-pointer text-xs font-semibold text-[#52784f] hover:underline"
              >
                Withdraw funds
              </button>
            </>
          )}
        </div>
      </div>
      {earningsLoading ? (
        <EarningsHistorySkeleton />
      ) : earnings?.recentEarnings.length ? (
        earnings.recentEarnings.map((item, index) => (
          <div
            key={item.id}
            className={`flex items-center gap-4 px-5 py-4 sm:px-6 ${index ? "border-t border-black/6" : ""}`}
          >
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-semibold">{item.title}</p>
              <p className="mt-1 truncate text-xs text-[#858a82]">
                {item.client} ·{" "}
                {new Date(item.date).toLocaleDateString("en-US", {
                  month: "long",
                  day: "numeric",
                  year: "numeric",
                })}
              </p>
            </div>
            <div className="text-right">
              <p className="text-[10px] text-[#9a9f96]">
                {formatCurrency(item.grossAmount)} · −
                {formatCurrency(item.platformFeeAmount)} fee (
                {item.grossAmount > 0
                  ? Math.round(
                      (item.platformFeeAmount / item.grossAmount) * 100,
                    )
                  : 0}
                %)
              </p>
              <p className="mt-0.5 text-sm font-semibold">
                {formatCurrency(item.amount)}
              </p>
              <p
                className={`mt-1 text-[10px] ${
                  item.status === "AVAILABLE"
                    ? "text-[#4d784a]"
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
              {item.status === "PENDING" && (
                <p className="mt-0.5 text-[10px] text-[#8a8f87]">
                  {formatAvailableIn(item.availableAt)}
                </p>
              )}
            </div>
          </div>
        ))
      ) : (
        <p className="px-5 py-8 text-center text-sm text-[#858a82] sm:px-6">
          No earnings yet.
        </p>
      )}
    </Panel>
  );
}

export function WithdrawalPanel() {
  const { getToken } = useAuth();
  const [redirecting, setRedirecting] = useState(false);
  const [error, setError] = useState("");

  const manageOnStripe = async () => {
    setRedirecting(true);
    setError("");
    try {
      const token = await getToken();
      const response = await fetch(
        `${process.env.NEXT_PUBLIC_SERVER_URI}/freelancer/payouts/connect-link?role=freelancer`,
        {
          headers: { Authorization: `Bearer ${token}` },
        },
      );
      const result = await response.json();
      if (!response.ok || !result.data?.url) {
        throw new Error(
          result.message || "Stripe could not be opened right now.",
        );
      }
      window.location.assign(result.data.url);
    } catch (error) {
      setError(
        error instanceof Error
          ? error.message
          : "Stripe could not be opened right now.",
      );
      setRedirecting(false);
    }
  };

  return (
    <Panel
      title="Withdrawal methods"
      description="Manage where your available earnings are sent through Stripe."
    >
      <div className="grid gap-4 p-5 sm:p-6">
        <article className="flex flex-col justify-between gap-4 rounded-2xl border border-black/8 bg-[#f8f9f6] p-5 sm:flex-row sm:items-center">
          <div className="flex items-center gap-4">
            <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-white text-[#52784f]">
              <Icon icon="solar:card-transfer-linear" width="23" />
            </span>
            <div>
              <h3 className="text-sm font-semibold">Payout account</h3>
              <p className="mt-1 text-xs text-[#7b8078]">
                Add your bank details, view payouts, and manage how you get paid
                on Stripe.
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
          Payouts are currently only available for freelancers based in the
          United States, United Kingdom, Canada, Switzerland, and the European
          Economic Area (EEA). Support for more countries is coming soon — your
          earnings stay safely on your account balance until then.
        </p>
      </div>
    </Panel>
  );
}

export function IdentityVerificationPanel({
  onStart,
}: {
  onStart: () => void;
}) {
  const { user } = useUser();
  const { getToken } = useAuth();
  const { data: profile, isLoading } = useQuery({
    queryKey: ["profile-metadata"],
    enabled: Boolean(user),
    queryFn: async () => {
      const token = await getToken();
      const response = await fetch(
        `${process.env.NEXT_PUBLIC_SERVER_URI}/freelancer/profile?role=freelancer`,
        { headers: { Authorization: `Bearer ${token}` }, cache: "no-store" },
      );
      const result = await response.json();
      if (!response.ok) throw new Error(result.message);
      return result.data;
    },
  });
  const verified = profile?.identityVerified === true;

  return (
    <Panel
      title="Identity verification"
      description="Verify your identity to build trust and unlock marketplace contracts."
    >
      <div className="grid gap-5 p-5 sm:p-6">
        <div className="flex flex-col gap-4 rounded-2xl border border-black/8 p-5 sm:flex-row sm:items-center">
          <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-[#edf4ea] text-[#52784f]">
            <Icon icon="solar:user-id-linear" width="24" />
          </span>
          <div className="min-w-0 flex-1">
            <h3 className="text-sm font-semibold">
              {verified ? "Identity verified" : "Verify your identity"}
            </h3>
            <p className="mt-1 text-xs leading-5 text-[#7b8078]">
              {verified
                ? "Your identity verification is complete."
                : "Complete verification before accepting your first contract."}
            </p>
          </div>
          {verified ? (
            <span className="inline-flex h-10 items-center gap-2 rounded-xl bg-[#e7f2e4] px-4 text-xs font-semibold text-[#4d784a]">
              <Icon icon="solar:verified-check-bold" width="18" />
              Verification done
            </span>
          ) : (
            <button
              type="button"
              data-stripe-identity-trigger
              onClick={onStart}
              disabled={isLoading}
              className="h-11 cursor-pointer rounded-xl bg-[#252724] px-5 text-sm font-semibold text-white disabled:cursor-wait disabled:opacity-50"
            >
              {isLoading ? "Checking..." : "Start verification"}
            </button>
          )}
        </div>
        <div className="flex gap-3 rounded-xl bg-[#f3f6f1] p-4 text-xs leading-5 text-[#667064]">
          <Icon
            icon="solar:shield-check-linear"
            width="19"
            className="shrink-0 text-[#52784f]"
          />
          <p>
            Verification is securely handled by Stripe. OneMarketplace does not
            store your identity document.
          </p>
        </div>
      </div>
    </Panel>
  );
}

interface AgencyData {
  id: string;
  name: string;
  professionalTitle: string | null;
  size: string;
  specialty: string;
  website: string | null;
  overview: string;
  tags: string[];
  isOnboarded: boolean;
  createdAt: string | null;
}

export function AgencyPanel() {
  const { getToken } = useAuth();
  const queryClient = useQueryClient();
  const [setupStarted, setSetupStarted] = useState(false);

  const { data: agency, isLoading } = useQuery({
    queryKey: ["agency-mine"],
    queryFn: async () => {
      const token = await getToken();

      const response = await fetch(
        `${process.env.NEXT_PUBLIC_SERVER_URI}/agency/mine?role=freelancer`,
        {
          headers: { Authorization: `Bearer ${token}` },
          cache: "no-store",
        },
      );

      const result = await response.json();

      if (!response.ok) {
        throw new Error(result.message || "The agency could not be loaded.");
      }

      return result.data as AgencyData | null;
    },
  });

  if (isLoading) {
    return (
      <Panel title="Agency" description="Loading your agency workspace...">
        <div className="p-5 sm:p-6">
          <div className="h-32 animate-pulse rounded-xl bg-[#eef0ec]" />
        </div>
      </Panel>
    );
  }

  if (agency) {
    return (
      <Panel
        title="Agency workspace"
        description="Your agency profile as clients will see it."
      >
        <div className="p-6 text-center sm:p-10">
          <span className="mx-auto flex h-16 w-16 items-center justify-center rounded-2xl bg-[#e6f2e3] text-[#4d784a]">
            <Icon icon="solar:buildings-2-bold" width="31" />
          </span>
          <h3 className="mt-5 text-xl font-semibold">{agency.name} is ready</h3>
          <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-[#737870]">
            Complete the agency profile, invite specialists, and choose which
            members can submit proposals on behalf of the agency.
          </p>
          <div className="mx-auto mt-6 grid max-w-md gap-3 text-left sm:grid-cols-2">
            <StatTile label="Team size" value={agency.size} />
            <StatTile label="Specialty" value={agency.specialty} />
          </div>
          <div className="mt-6 flex flex-wrap justify-center gap-2">
            <a
              href={process.env.NEXT_PUBLIC_AGENCY_DASHBOARD}
              className="h-11 inline-flex items-center rounded-xl bg-[#252724] px-5 text-sm font-semibold text-white!"
            >
              Open agency workspace
            </a>
            <a
              href={`${process.env.NEXT_PUBLIC_AGENCY_DASHBOARD}/team`}
              className="h-11 inline-flex items-center rounded-xl border border-black/10 px-5 text-sm font-semibold"
            >
              Invite team members
            </a>
          </div>
        </div>
      </Panel>
    );
  }

  if (setupStarted) {
    return (
      <AgencySetupForm
        onBack={() => setSetupStarted(false)}
        onCreated={(created) => {
          queryClient.setQueryData(["agency-mine"], created);
        }}
      />
    );
  }

  return (
    <Panel
      title="Create an agency"
      description="Build a team workspace while keeping your individual freelancer profile."
    >
      <div className="grid gap-6 p-5 sm:p-6">
        <section className="overflow-hidden rounded-2xl bg-[#252724] p-6 text-white sm:p-7">
          <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-white/10 text-[#a8c5a1]">
            <Icon icon="solar:buildings-2-linear" width="23" />
          </span>
          <h3 className="mt-5 text-2xl font-semibold tracking-[-0.035em]">
            Win larger projects together.
          </h3>
          <p className="mt-2 max-w-xl text-sm leading-6 text-white/65">
            An agency workspace lets you present a combined team, submit agency
            proposals, coordinate delivery, and manage shared contracts.
          </p>
          <button
            type="button"
            onClick={() => setSetupStarted(true)}
            className="mt-6 h-11 cursor-pointer rounded-xl bg-white px-5 text-sm font-semibold text-[#252724]"
          >
            Start agency setup
          </button>
        </section>

        <div className="grid gap-3 sm:grid-cols-3">
          {[
            [
              "Keep your profile",
              "Continue working independently whenever you choose.",
              "solar:user-circle-linear",
            ],
            [
              "Invite specialists",
              "Build a trusted roster and assign clear agency roles.",
              "solar:users-group-rounded-linear",
            ],
            [
              "Manage together",
              "Centralize proposals, contracts, messages, and payouts.",
              "solar:widget-5-linear",
            ],
          ].map(([title, detail, icon]) => (
            <article
              key={title}
              className="rounded-xl border border-black/7 p-4"
            >
              <Icon icon={icon} width="21" className="text-[#52784f]" />
              <h4 className="mt-3 text-sm font-semibold">{title}</h4>
              <p className="mt-1.5 text-xs leading-5 text-[#7b8078]">
                {detail}
              </p>
            </article>
          ))}
        </div>

        <div className="rounded-xl bg-[#f1f3ef] p-4 text-xs leading-6 text-[#70766e]">
          <strong className="text-[#343833]">Before you begin:</strong> Creating
          an agency does not replace or hide your individual freelancer account.
        </div>
      </div>
    </Panel>
  );
}

const agencySizeOptions = [
  "2–5 members",
  "6–10 members",
  "11–25 members",
  "26+ members",
];

const agencySpecialtyOptions = [
  "Web & software development",
  "Design & creative",
  "Data & AI",
  "Marketing",
  "Writing & content",
];

function AgencySetupForm({
  onBack,
  onCreated,
}: {
  onBack: () => void;
  onCreated: (agency: AgencyData) => void;
}) {
  const { getToken } = useAuth();
  const [name, setName] = useState("");
  const [size, setSize] = useState("");
  const [specialty, setSpecialty] = useState("");
  const [website, setWebsite] = useState("");
  const [overview, setOverview] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const isComplete =
    name.trim().length > 0 &&
    size.length > 0 &&
    specialty.length > 0 &&
    overview.trim().length > 0 &&
    confirmed;

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!isComplete) return;

    setSaving(true);
    setError("");
    try {
      const token = await getToken();
      const response = await fetch(
        `${process.env.NEXT_PUBLIC_SERVER_URI}/agency?role=freelancer`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            name: name.trim(),
            size,
            specialty,
            website: website.trim() || undefined,
            overview: overview.trim(),
          }),
        },
      );
      const result = await response.json();
      if (!response.ok) {
        throw new Error(result.message || "The agency could not be created.");
      }
      onCreated(result.data as AgencyData);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "The agency could not be created.",
      );
    } finally {
      setSaving(false);
    }
  };

  return (
    <Panel
      title="Create an agency"
      description="Set up the workspace clients will see when working with your team."
    >
      <form onSubmit={(event) => void submit(event)} className="grid gap-5 p-5 sm:p-6">
        <div className="grid gap-4 sm:grid-cols-2">
          <label className="text-xs font-semibold">
            Agency name
            <input
              required
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="e.g. Northstar Digital"
              className={inputClass}
            />
          </label>
          <label className="text-xs font-semibold">
            Agency size
            <select
              required
              value={size}
              onChange={(event) => setSize(event.target.value)}
              className="mt-2 h-11 w-full rounded-xl border border-black/10 bg-white px-3 text-sm font-normal outline-none focus:border-[#6e916a]"
            >
              <option value="" disabled>
                Select team size
              </option>
              {agencySizeOptions.map((option) => (
                <option key={option}>{option}</option>
              ))}
            </select>
          </label>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <label className="text-xs font-semibold">
            Primary specialty
            <select
              required
              value={specialty}
              onChange={(event) => setSpecialty(event.target.value)}
              className="mt-2 h-11 w-full rounded-xl border border-black/10 bg-white px-3 text-sm font-normal outline-none focus:border-[#6e916a]"
            >
              <option value="" disabled>
                Select a specialty
              </option>
              {agencySpecialtyOptions.map((option) => (
                <option key={option}>{option}</option>
              ))}
            </select>
          </label>
          <label className="text-xs font-semibold">
            Website{" "}
            <span className="font-normal text-[#8a8f87]">(optional)</span>
            <input
              type="url"
              value={website}
              onChange={(event) => setWebsite(event.target.value)}
              placeholder="https://agency.com"
              className={inputClass}
            />
          </label>
        </div>
        <label className="text-xs font-semibold">
          Agency overview
          <textarea
            required
            rows={4}
            value={overview}
            onChange={(event) => setOverview(event.target.value)}
            placeholder="Describe your team, expertise, and the outcomes you deliver…"
            className="mt-2 w-full resize-none rounded-xl border border-black/10 p-3 text-sm font-normal outline-none focus:border-[#6e916a]"
          />
        </label>
        <label className="flex cursor-pointer items-start gap-3 rounded-xl bg-[#f3f5f1] p-4 text-xs leading-5 text-[#686e66]">
          <input
            required
            type="checkbox"
            checked={confirmed}
            onChange={(event) => setConfirmed(event.target.checked)}
            className="mt-0.5 h-4 w-4 shrink-0 accent-[#5f875c]"
          />
          I confirm that I am authorized to create and administer this agency
          workspace.
        </label>
        {error && <p className="text-xs text-red-600">{error}</p>}
        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={onBack}
            disabled={saving}
            className="h-11 cursor-pointer rounded-xl border border-black/10 px-5 text-sm font-semibold disabled:cursor-not-allowed disabled:opacity-50"
          >
            Back
          </button>
          <button
            type="submit"
            disabled={!isComplete || saving}
            className="h-11 cursor-pointer rounded-xl bg-[#252724] px-5 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-40"
          >
            {saving ? "Creating..." : "Create agency"}
          </button>
        </div>
      </form>
    </Panel>
  );
}

function PasswordSection() {
  const { user } = useUser();
  const updatePassword = useReverification(
    (params: {
      currentPassword?: string;
      newPassword: string;
      signOutOfOtherSessions: boolean;
    }) => user?.updatePassword(params),
  );
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [signOutOthers, setSignOutOthers] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState(false);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setError("");
    setSuccess(false);

    if (newPassword !== confirmPassword) {
      setError("New passwords do not match.");
      return;
    }

    setSaving(true);
    try {
      await updatePassword({
        currentPassword: user?.passwordEnabled ? currentPassword : undefined,
        newPassword,
        signOutOfOtherSessions: signOutOthers,
      });
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
      setSuccess(true);
    } catch (err) {
      setError(extractClerkError(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Panel
      title="Password"
      description={
        user?.passwordEnabled
          ? "Update the password you use to sign in."
          : "Set a password to sign in without a code or social login."
      }
    >
      <form
        onSubmit={(event) => void submit(event)}
        className="grid gap-4 p-5 sm:p-6"
      >
        {user?.passwordEnabled && (
          <label className="text-xs font-semibold">
            Current password
            <input
              required
              type="password"
              placeholder="********"
              autoComplete="current-password"
              value={currentPassword}
              onChange={(event) => setCurrentPassword(event.target.value)}
              className={inputClass}
            />
          </label>
        )}
        <div className="grid gap-4 sm:grid-cols-2">
          <label className="text-xs font-semibold">
            New password
            <input
              required
              type="password"
              placeholder="********"
              autoComplete="new-password"
              value={newPassword}
              onChange={(event) => setNewPassword(event.target.value)}
              className={inputClass}
            />
          </label>
          <label className="text-xs font-semibold">
            Confirm new password
            <input
              required
              type="password"
              placeholder="********"
              autoComplete="new-password"
              value={confirmPassword}
              onChange={(event) => setConfirmPassword(event.target.value)}
              className={inputClass}
            />
          </label>
        </div>
        <label className="flex cursor-pointer items-center gap-3 text-xs font-semibold text-[#686e66]">
          <input
            type="checkbox"
            checked={signOutOthers}
            onChange={(event) => setSignOutOthers(event.target.checked)}
            className="h-4 w-4 accent-[#5f875c]"
          />
          Sign out of all other devices
        </label>
        {error && <p className="text-xs text-red-600">{error}</p>}
        {success && (
          <p className="text-xs font-semibold text-[#4d784a]">
            Your password has been updated.
          </p>
        )}
        <div className="flex justify-end">
          <button
            type="submit"
            disabled={saving}
            className="h-11 cursor-pointer rounded-xl bg-[#252724] px-5 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50"
          >
            {saving
              ? "Saving..."
              : user?.passwordEnabled
                ? "Update password"
                : "Set password"}
          </button>
        </div>
      </form>
    </Panel>
  );
}

function TwoFactorSection() {
  const { user } = useUser();
  const createTOTP = useReverification(() => user?.createTOTP());
  const disableTOTP = useReverification(() => user?.disableTOTP());
  const [totp, setTotp] = useState<TOTPResource | null>(null);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const enabled = Boolean(user?.twoFactorEnabled);

  const startSetup = async () => {
    setError("");
    setBusy(true);
    try {
      const created = await createTOTP();
      setTotp(created ?? null);
    } catch (err) {
      setError(extractClerkError(err));
    } finally {
      setBusy(false);
    }
  };

  const cancelSetup = () => {
    setTotp(null);
    setCode("");
    setError("");
  };

  const verify = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      await user?.verifyTOTP({ code });
      await user?.reload();
      setTotp(null);
      setCode("");
    } catch (err) {
      setError(extractClerkError(err));
    } finally {
      setBusy(false);
    }
  };

  const disable = async () => {
    setBusy(true);
    setError("");
    try {
      await disableTOTP();
      await user?.reload();
    } catch (err) {
      setError(extractClerkError(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Panel
      title="Two-factor authentication"
      description="Add an extra layer of security using an authenticator app."
    >
      <div className="grid gap-4 p-5 sm:p-6">
        <div className="flex flex-col justify-between gap-4 rounded-2xl border border-black/8 bg-[#f8f9f6] p-5 sm:flex-row sm:items-center">
          <div className="flex items-center gap-4">
            <span
              className={`flex h-11 w-11 items-center justify-center rounded-xl bg-white ${enabled ? "text-[#52784f]" : "text-[#9a9f96]"}`}
            >
              <Icon icon="solar:shield-keyhole-linear" width="22" />
            </span>
            <div>
              <h3 className="text-sm font-semibold">
                {enabled
                  ? "Two-factor authentication is on"
                  : "Authenticator app"}
              </h3>
              <p className="mt-1 text-xs text-[#7b8078]">
                {enabled
                  ? "Codes from your authenticator app are required at sign-in."
                  : "Use an app like Google Authenticator or 1Password."}
              </p>
            </div>
          </div>
          {enabled ? (
            <button
              type="button"
              onClick={() => void disable()}
              disabled={busy}
              className="h-10 cursor-pointer rounded-xl border border-black/10 px-4 text-xs font-semibold disabled:cursor-not-allowed disabled:opacity-50"
            >
              Disable
            </button>
          ) : (
            !totp && (
              <button
                type="button"
                onClick={() => void startSetup()}
                disabled={busy}
                className="h-10 cursor-pointer rounded-xl bg-[#252724] px-4 text-xs font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50"
              >
                {busy ? "Starting..." : "Enable 2FA"}
              </button>
            )
          )}
        </div>

        {totp && (
          <form
            onSubmit={(event) => void verify(event)}
            className="grid gap-4 rounded-2xl border border-black/8 p-5"
          >
            <p className="text-xs leading-5 text-[#7b8078]">
              Scan this into your authenticator app, or enter the setup key
              manually, then confirm with the 6-digit code it generates.
            </p>
            {totp.uri && (
              <img
                src={`https://api.qrserver.com/v1/create-qr-code/?size=180x180&data=${encodeURIComponent(totp.uri)}`}
                alt="Authenticator QR code"
                width={180}
                height={180}
                className="rounded-xl border border-black/8"
              />
            )}
            {totp.secret && (
              <p className="rounded-xl bg-[#f3f5f1] px-3 py-2 font-mono text-xs break-all">
                {totp.secret}
              </p>
            )}
            <label className="text-xs font-semibold">
              Verification code
              <input
                required
                inputMode="numeric"
                autoComplete="one-time-code"
                value={code}
                onChange={(event) => setCode(event.target.value)}
                className={inputClass}
                placeholder="123456"
              />
            </label>
            {error && <p className="text-xs text-red-600">{error}</p>}
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={cancelSetup}
                className="h-10 cursor-pointer rounded-xl border border-black/10 px-4 text-xs font-semibold"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={busy}
                className="h-10 cursor-pointer rounded-xl bg-[#252724] px-4 text-xs font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50"
              >
                {busy ? "Verifying..." : "Verify & enable"}
              </button>
            </div>
          </form>
        )}
        {!totp && error && <p className="text-xs text-red-600">{error}</p>}
      </div>
    </Panel>
  );
}

const formatSessionDevice = (session: SessionWithActivitiesResource) => {
  const activity = session.latestActivity;
  const browser = activity?.browserName || "Unknown browser";
  const device = activity?.isMobile
    ? "Mobile"
    : activity?.deviceType || "Desktop";
  const place = [activity?.city, activity?.country].filter(Boolean).join(", ");
  return { browser, device, place };
};

function ActiveSessionsSection() {
  const { user } = useUser();
  const { session: currentSession } = useSession();
  const [sessions, setSessions] = useState<
    SessionWithActivitiesResource[] | null
  >(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  useEffect(() => {
    if (!user) return;
    user
      .getSessions()
      .then(setSessions)
      .catch(() => setSessions([]));
  }, [user]);

  const revoke = async (target: SessionWithActivitiesResource) => {
    setBusyId(target.id);
    try {
      await target.revoke();
      setSessions(
        (prev) => prev?.filter((item) => item.id !== target.id) ?? null,
      );
    } finally {
      setBusyId(null);
    }
  };

  return (
    <Panel
      title="Active devices"
      description="Devices currently signed in to your account."
    >
      {sessions === null ? (
        <div className="p-5 sm:p-6">
          <div className="h-14 animate-pulse rounded-xl bg-[#eef0ec]" />
        </div>
      ) : sessions.length === 0 ? (
        <p className="px-5 py-8 text-center text-sm text-[#858a82] sm:px-6">
          No active sessions found.
        </p>
      ) : (
        <div>
          {sessions.map((item, index) => {
            const { browser, device, place } = formatSessionDevice(item);
            const isCurrent = item.id === currentSession?.id;
            return (
              <div
                key={item.id}
                className={`flex items-center gap-4 px-5 py-4 sm:px-6 ${index ? "border-t border-black/6" : ""}`}
              >
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[#f3f5f1] text-[#52784f]">
                  <Icon
                    icon={
                      device === "Mobile"
                        ? "solar:smartphone-linear"
                        : "solar:laptop-linear"
                    }
                    width="17"
                  />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold">
                    {browser} · {device}
                    {isCurrent && (
                      <span className="ml-2 rounded-full bg-[#e7f2e4] px-2 py-0.5 text-[10px] font-semibold text-[#4d784a]">
                        This device
                      </span>
                    )}
                  </p>
                  <p className="mt-1 truncate text-xs text-[#858a82]">
                    {place || "Unknown location"} · Active{" "}
                    {format(item.lastActiveAt)}
                  </p>
                </div>
                {!isCurrent && (
                  <button
                    type="button"
                    onClick={() => void revoke(item)}
                    disabled={busyId === item.id}
                    className="cursor-pointer text-xs font-semibold text-red-600 hover:underline disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {busyId === item.id ? "Signing out..." : "Sign out"}
                  </button>
                )}
              </div>
            );
          })}
        </div>
      )}
    </Panel>
  );
}

export function AccountPanel({ kind }: { kind: "security" | "notifications" }) {
  if (kind === "security")
    return (
      <div className="grid gap-5">
        <PasswordSection />
        <TwoFactorSection />
        <ActiveSessionsSection />
      </div>
    );

  return (
    <Panel
      title="Notification preferences"
      description="Control which account updates you receive."
    >
      <div className="divide-y divide-black/6 p-5 sm:p-6">
        {[
          "Proposal and interview activity",
          "Contract and milestone updates",
          "Messages from clients",
          "Payments and withdrawals",
          "Product news and recommendations",
        ].map((label, index) => (
          <label
            key={label}
            className="flex cursor-pointer items-center justify-between gap-4 py-4 first:pt-0 last:pb-0"
          >
            <span className="text-sm font-medium">{label}</span>
            <input
              type="checkbox"
              defaultChecked={index < 4}
              className="h-4 w-4 accent-[#5f875c]"
            />
          </label>
        ))}
      </div>
    </Panel>
  );
}
