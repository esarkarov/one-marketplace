"use client";

import { Icon } from "@iconify/react";
import { useAuth } from "@clerk/nextjs";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { ContractCard } from "../_components/contracts/contract-card";
import { ContractDrawer } from "../_components/contracts/contract-drawer";
import { SubmitWorkModal } from "../_components/contracts/submit-work-modal";
import { ContractReviewModal } from "../_components/contracts/contract-review-modal";
import type { Contract } from "../_components/contracts/types";
import { DashboardHeader } from "../_components/dashboard/dashboard-header";
import { WorkspaceSidebar } from "../_components/dashboard/workspace-sidebar";

type ApiContract = {
  id: string;
  title: string;
  description: string;
  totalAmount: number;
  status: "PENDING" | "ACTIVE" | "COMPLETED";
  startedAt: string | null;
  createdAt: string;
  conversationId: string | null;
  counterpartyName: string;
  counterpartyAvatar: string | null;
  reviewedByCurrentUser: boolean;
  milestones: Array<{
    id: string;
    title: string;
    amount: number;
    dueDate: string;
    status: "PENDING" | "ACTIVE" | "COMPLETED";
    fundedAt: string | null;
    paymentRequestedAt: string | null;
  }>;
};

const money = (value: number) => `$${value.toLocaleString()}`;
const formatDate = (value: string) =>
  new Intl.DateTimeFormat("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
  }).format(new Date(value));

const mapContract = (contract: ApiContract): Contract => {
  const earned = contract.milestones
    .filter((milestone) => milestone.status === "COMPLETED")
    .reduce((total, milestone) => total + milestone.amount, 0);
  const funded = contract.milestones
    .filter(
      (milestone) => milestone.fundedAt && milestone.status !== "COMPLETED",
    )
    .reduce((total, milestone) => total + milestone.amount, 0);
  const activeMilestone = contract.milestones.find(
    (milestone) => milestone.status === "ACTIVE",
  );
  const current =
    activeMilestone ??
    contract.milestones.find((milestone) => milestone.status !== "COMPLETED");

  return {
    id: contract.id,
    conversationId: contract.conversationId,
    title: contract.title,
    client: contract.counterpartyName,
    clientInitials: contract.counterpartyName
      .split(" ")
      .map((part) => part[0])
      .join("")
      .slice(0, 2),
    clientAvatar: contract.counterpartyAvatar,
    clientLocation: "",
    status:
      contract.status === "PENDING"
        ? "Pending"
        : contract.status === "ACTIVE"
          ? activeMilestone?.paymentRequestedAt
            ? "Awaiting feedback"
            : "Active"
          : "Completed",
    started: formatDate(contract.startedAt ?? contract.createdAt),
    totalBudget: money(contract.totalAmount),
    earned: money(earned),
    funded: money(funded),
    nextDeadline: current ? formatDate(current.dueDate) : "Completed",
    progress: contract.totalAmount
      ? Math.round((earned / contract.totalAmount) * 100)
      : 0,
    currentMilestone: current?.title ?? "All milestones completed",
    currentMilestoneId: activeMilestone?.id,
    description: contract.description,
    milestones: contract.milestones.map((milestone) => ({
      id: milestone.id,
      title: milestone.title,
      amount: money(milestone.amount),
      due: formatDate(milestone.dueDate),
      status:
        milestone.status === "COMPLETED"
          ? "Paid"
          : milestone.status === "ACTIVE" || milestone.fundedAt
            ? "In progress"
            : "Upcoming",
      paymentRequestedAt: milestone.paymentRequestedAt,
    })),
    reviewedByCurrentUser: contract.reviewedByCurrentUser,
  };
};

export function ContractsDashboard() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const queryClient = useQueryClient();
  const { getToken } = useAuth();
  const [status, setStatus] = useState("All running");
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<Contract | null>(null);
  const [submitTarget, setSubmitTarget] = useState<Contract | null>(null);
  const [reviewTarget, setReviewTarget] = useState<Contract | null>(null);
  const { data = [], isLoading } = useQuery<ApiContract[]>({
    queryKey: ["freelancer-contracts"],
    queryFn: async () => {
      const token = await getToken();
      const response = await fetch(
        `${process.env.NEXT_PUBLIC_SERVER_URI}/contracts/freelancer?role=freelancer`,
        { headers: { Authorization: `Bearer ${token}` } },
      );
      const result = await response.json();
      if (!response.ok) throw new Error(result.message);
      return result.data;
    },
  });
  const contracts = useMemo(() => data.map(mapContract), [data]);

  useEffect(() => {
    const contractId = searchParams.get("contractId");
    if (!contractId) return;
    const match = contracts.find(({ id }) => id === contractId);
    if (match) setSelected(match);
  }, [contracts, searchParams]);

  const acceptContract = async (contract: Contract) => {
    let profile = queryClient.getQueryData<{ identityVerified?: boolean }>([
      "profile-metadata",
    ]);

    if (!profile) {
      profile = await queryClient.fetchQuery({
        queryKey: ["profile-metadata"],
        queryFn: async () => {
          const token = await getToken();
          const response = await fetch(
            `${process.env.NEXT_PUBLIC_SERVER_URI}/freelancer/profile?role=freelancer`,
            { headers: { Authorization: `Bearer ${token}` } },
          );
          const result = await response.json();
          if (!response.ok) throw new Error(result.message);
          return result.data;
        },
      });
    }

    if (!profile?.identityVerified) {
      router.push("/settings?section=verification&active=true");
      return;
    }

    const token = await getToken();
    const response = await fetch(
      `${process.env.NEXT_PUBLIC_SERVER_URI}/contracts/${contract.id}/accept?role=freelancer`,
      {
        method: "PATCH",
        headers: { Authorization: `Bearer ${token}` },
      },
    );
    const result = await response.json();
    if (!response.ok) throw new Error(result.message);

    setSelected(null);
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["freelancer-contracts"] }),
      queryClient.invalidateQueries({ queryKey: ["freelancer-conversations"] }),
    ]);
  };

  const submitWork = async (
    contract: Contract,
    input: { submissionMessage: string; submissionDeliveryLink?: string },
  ) => {
    if (!contract.currentMilestoneId) {
      throw new Error("Active milestone was not found.");
    }
    const token = await getToken();
    const response = await fetch(
      `${process.env.NEXT_PUBLIC_SERVER_URI}/contracts/${contract.id}/milestones/${contract.currentMilestoneId}/submit?role=freelancer`,
      {
        method: "PATCH",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(input),
      },
    );
    const result = await response.json();
    if (!response.ok) throw new Error(result.message);
    await queryClient.invalidateQueries({ queryKey: ["freelancer-contracts"] });
  };

  const finishContract = async (
    contract: Contract,
    input: { rating: number; comment: string },
  ) => {
    const token = await getToken();
    const response = await fetch(
      `${process.env.NEXT_PUBLIC_SERVER_URI}/contracts/${contract.id}/finish?role=freelancer`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(input),
      },
    );
    const result = await response.json();
    if (!response.ok) throw new Error(result.message);
    await queryClient.invalidateQueries({ queryKey: ["freelancer-contracts"] });
  };

  const visibleContracts = useMemo(() => {
    const query = search.trim().toLowerCase();
    return contracts.filter(
      (contract) =>
        (status === "All running" || contract.status === status) &&
        (!query ||
          `${contract.title} ${contract.client} ${contract.currentMilestone}`
            .toLowerCase()
            .includes(query)),
    );
  }, [contracts, search, status]);

  const totalValue = data.reduce(
    (total, contract) => total + contract.totalAmount,
    0,
  );
  const earned = data
    .flatMap((contract) => contract.milestones)
    .reduce(
      (total, milestone) =>
        total + (milestone.status === "COMPLETED" ? milestone.amount : 0),
      0,
    );
  const funded = data
    .flatMap((contract) => contract.milestones)
    .reduce(
      (total, milestone) =>
        total +
        (milestone.fundedAt && milestone.status !== "COMPLETED"
          ? milestone.amount
          : 0),
      0,
    );

  return (
    <div className="min-h-svh bg-[#f4f6f2] font-(family-name:--font-dm-sans) text-[#242724]">
      <DashboardHeader />
      <main className="mx-auto max-w-360 px-5 py-8 sm:px-8 lg:py-10">
        <div className="grid items-start gap-6 xl:grid-cols-[240px_minmax(0,1fr)]">
          <WorkspaceSidebar />
          <div className="min-w-0">
            <div className="flex flex-col justify-between gap-5 sm:flex-row sm:items-end">
              <div>
                <p className="text-xs font-semibold tracking-[0.14em] text-[#62805f] uppercase">
                  Delivery workspace
                </p>
                <h1 className="mt-2 text-3xl font-semibold tracking-[-0.045em] sm:text-4xl">
                  My contracts
                </h1>
                <p className="mt-2 text-sm text-[#72776f]">
                  Manage milestones, submit work, and keep every active contract
                  moving.
                </p>
              </div>
            </div>

            <section className="mt-8 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              {[
                [
                  "Active contracts",
                  String(
                    contracts.filter((contract) => contract.status === "Active")
                      .length,
                  ),
                  "solar:case-round-linear",
                  "bg-[#e7f2e4] text-[#4d784a]",
                ],
                [
                  "Contract value",
                  money(totalValue),
                  "solar:wallet-money-linear",
                  "bg-[#e8eff4] text-[#4c6e86]",
                ],
                [
                  "Earned",
                  money(earned),
                  "solar:hand-money-linear",
                  "bg-[#f1f0e6] text-[#766f47]",
                ],
                [
                  "Funded now",
                  money(funded),
                  "solar:shield-check-linear",
                  "bg-[#eeeaf5] text-[#6b5d82]",
                ],
              ].map(([label, value, icon, color]) => (
                <div
                  key={label}
                  className="flex items-center gap-4 rounded-2xl border border-black/8 bg-white p-5"
                >
                  <span
                    className={`flex h-11 w-11 items-center justify-center rounded-xl ${color}`}
                  >
                    <Icon icon={icon} width="22" />
                  </span>
                  <div>
                    <p className="text-2xl font-semibold tracking-[-0.04em]">
                      {value}
                    </p>
                    <p className="mt-0.5 text-xs text-[#7c8179]">{label}</p>
                  </div>
                </div>
              ))}
            </section>

            <section className="mt-6 flex flex-col gap-4 rounded-2xl border border-black/8 bg-white p-4 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex gap-1 overflow-x-auto">
                {["All running", "Pending", "Active", "Completed"].map(
                  (item) => (
                    <button
                      key={item}
                      type="button"
                      onClick={() => setStatus(item)}
                      className={`shrink-0 cursor-pointer rounded-lg px-3 py-2 text-xs font-semibold ${status === item ? "bg-[#edf4ea] text-[#4e774b]" : "text-[#747971] hover:bg-black/3"}`}
                    >
                      {item}
                    </button>
                  ),
                )}
              </div>
              <label className="flex h-10 items-center gap-2 rounded-xl border border-black/9 px-3 sm:w-72">
                <Icon
                  icon="solar:magnifer-linear"
                  width="18"
                  className="text-[#7b8078]"
                />
                <input
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  placeholder="Search contracts"
                  className="min-w-0 flex-1 bg-transparent text-sm outline-none"
                />
              </label>
            </section>

            <div className="mt-4 grid gap-4">
              {isLoading && <ContractsSkeleton />}
              {visibleContracts.map((contract) => (
                <ContractCard
                  key={contract.id}
                  contract={contract}
                  onView={(contract) => {
                    router.push(`/contracts?contractId=${contract.id}`);
                  }}
                  onSubmit={setSubmitTarget}
                  onAccept={(contract) => void acceptContract(contract)}
                  onReject={() => undefined}
                  onFinish={setReviewTarget}
                />
              ))}
              {!isLoading && !visibleContracts.length && (
                <div className="rounded-2xl border border-black/8 bg-white px-6 py-16 text-center">
                  <Icon
                    icon="solar:case-round-linear"
                    width="36"
                    className="mx-auto text-[#858a82]"
                  />
                  <h2 className="mt-4 font-semibold">No contracts found</h2>
                  <p className="mt-2 text-sm text-[#7c8179]">
                    Try another status or search term.
                  </p>
                </div>
              )}
            </div>
          </div>
        </div>
      </main>

      {selected && (
        <ContractDrawer
          contract={selected}
          onClose={() => {
            setSelected(null);
            router.replace("/contracts");
          }}
          onSubmit={() => {
            setSubmitTarget(selected);
            setSelected(null);
          }}
          onAccept={() => void acceptContract(selected)}
          onReject={() => undefined}
          onFinish={() => setReviewTarget(selected)}
        />
      )}
      {submitTarget && (
        <SubmitWorkModal
          contract={submitTarget}
          onClose={() => setSubmitTarget(null)}
          onSubmit={(input) => submitWork(submitTarget, input)}
        />
      )}
      {reviewTarget && (
        <ContractReviewModal
          contractTitle={reviewTarget.title}
          revieweeName={reviewTarget.client}
          actionLabel={
            reviewTarget.status === "Completed"
              ? "Submit review"
              : "Finish contract"
          }
          onClose={() => setReviewTarget(null)}
          onSubmit={(input) => finishContract(reviewTarget, input)}
        />
      )}
    </div>
  );
}

function ContractsSkeleton() {
  return (
    <div className="animate-pulse rounded-2xl border border-black/8 bg-white p-6">
      <div className="h-5 w-24 rounded bg-[#e8ebe6]" />
      <div className="mt-4 h-7 w-72 rounded bg-[#e8ebe6]" />
      <div className="mt-6 h-28 rounded-xl bg-[#f0f2ee]" />
    </div>
  );
}
