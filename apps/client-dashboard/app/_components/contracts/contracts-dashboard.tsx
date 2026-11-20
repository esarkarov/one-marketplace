"use client";

import { Icon } from "@iconify/react";
import { useAuth } from "@clerk/nextjs";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import { type ClientContract } from "../data/client-data";

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
  reviewedByCurrentUser: boolean;
  milestones: Array<{
    id: string;
    title: string;
    amount: number;
    dueDate: string;
    status: "PENDING" | "ACTIVE" | "COMPLETED";
    fundedAt: string | null;
    completedAt: string | null;
  }>;
};

const formatDate = (value: string) =>
  new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(new Date(value));

const mapContract = (contract: ApiContract): ClientContract => {
  const paid = contract.milestones
    .filter((milestone) => milestone.status === "COMPLETED")
    .reduce((total, milestone) => total + milestone.amount, 0);
  const escrow = contract.milestones
    .filter(
      (milestone) => milestone.fundedAt && milestone.status !== "COMPLETED",
    )
    .reduce((total, milestone) => total + milestone.amount, 0);
  const nextMilestone = contract.milestones.find(
    (milestone) => milestone.status !== "COMPLETED",
  );

  return {
    id: contract.id,
    title: contract.title,
    talent: contract.counterpartyName,
    initials: contract.counterpartyName
      .split(" ")
      .map((part) => part[0])
      .join("")
      .slice(0, 2),
    accountType: "Freelancer",
    status:
      contract.status === "PENDING"
        ? "Awaiting approval"
        : contract.status === "ACTIVE"
          ? "Active"
          : "Completed",
    started: formatDate(contract.startedAt ?? contract.createdAt),
    totalBudget: contract.totalAmount,
    paid,
    escrow,
    progress: contract.totalAmount
      ? Math.round((paid / contract.totalAmount) * 100)
      : 0,
    nextDeadline: nextMilestone
      ? formatDate(nextMilestone.dueDate)
      : "Completed",
    description: contract.description,
    reviewedByCurrentUser: contract.reviewedByCurrentUser,
    milestones: contract.milestones.map((milestone) => ({
      id: milestone.id,
      title: milestone.title,
      amount: milestone.amount,
      due: formatDate(milestone.dueDate),
      status:
        milestone.status === "COMPLETED"
          ? "Paid"
          : milestone.status === "ACTIVE" || milestone.fundedAt
            ? "In progress"
            : "Upcoming",
    })),
  };
};

export function ContractsDashboard() {
  const { getToken } = useAuth();
  const queryClient = useQueryClient();
  const router = useRouter();
  const searchParams = useSearchParams();
  const [contracts, setContracts] = useState<ClientContract[]>([]);
  const [selected, setSelected] = useState<ClientContract | null>(null);
  const [notice, setNotice] = useState("");
  const [reviewTarget, setReviewTarget] = useState<ClientContract | null>(null);
  const { data, isLoading } = useQuery<ApiContract[]>({
    queryKey: ["client-contracts"],
    queryFn: async () => {
      const token = await getToken();
      const response = await fetch(
        `${process.env.NEXT_PUBLIC_SERVER_URI}/contracts/client?role=client`,
        { headers: { Authorization: `Bearer ${token}` } },
      );
      const result = await response.json();
      if (!response.ok) throw new Error(result.message);
      return result.data;
    },
  });

  useEffect(() => {
    if (data) setContracts(data.map(mapContract));
  }, [data]);

  useEffect(() => {
    const contractId = searchParams.get("contractId");
    if (!contractId) return;
    const match = contracts.find(({ id }) => id === contractId);
    if (match) setSelected(match);
  }, [contracts, searchParams]);

  useEffect(() => {
    if (!notice) return;
    const timeout = window.setTimeout(() => setNotice(""), 3500);
    return () => window.clearTimeout(timeout);
  }, [notice]);

  const approve = (
    contractId: ClientContract["id"],
    milestoneId: ClientContract["milestones"][number]["id"],
  ) => {
    setContracts((current) =>
      current.map((contract) =>
        contract.id === contractId
          ? updateApprovedMilestone(contract, milestoneId)
          : contract,
      ),
    );
    setSelected(null);
    setNotice("Milestone approved and payment released.");
  };
  const requestChanges = (
    contractId: ClientContract["id"],
    milestoneId: ClientContract["milestones"][number]["id"],
    feedback: string,
  ) => {
    setContracts((current) =>
      current.map((contract) =>
        contract.id === contractId
          ? {
              ...contract,
              status: "Active",
              milestones: contract.milestones.map((milestone) =>
                milestone.id === milestoneId
                  ? {
                      ...milestone,
                      status: "In progress" as const,
                      submissionComment: feedback,
                    }
                  : milestone,
              ),
            }
          : contract,
      ),
    );
    setSelected(null);
    setNotice("Changes requested. Your feedback was sent to the freelancer.");
  };
  const activateMilestone = async (
    contractId: ClientContract["id"],
    milestoneId: ClientContract["milestones"][number]["id"],
    requirements: string,
  ) => {
    const token = await getToken();
    const response = await fetch(
      `${process.env.NEXT_PUBLIC_SERVER_URI}/contracts/${contractId}/milestones/${milestoneId}/checkout?role=client`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ requirements: requirements || undefined }),
      },
    );
    const result = await response.json();
    if (!response.ok) throw new Error(result.message);
    window.location.assign(result.data.url);
  };
  const addMilestone = async (
    contractId: ClientContract["id"],
    input: { title: string; amount: number; dueDate: string },
  ) => {
    const token = await getToken();
    const response = await fetch(
      `${process.env.NEXT_PUBLIC_SERVER_URI}/contracts/${contractId}/milestones?role=client`,
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
    const update = (contract: ClientContract): ClientContract => ({
      ...contract,
      status: "Active",
      totalBudget: contract.totalBudget + result.data.amount,
      nextDeadline: formatDate(result.data.dueDate),
      progress: Math.round(
        (contract.paid / (contract.totalBudget + result.data.amount)) * 100,
      ),
      milestones: [
        ...contract.milestones,
        {
          id: result.data.id,
          title: result.data.title,
          amount: result.data.amount,
          due: formatDate(result.data.dueDate),
          status: "Upcoming",
        },
      ],
    });
    setContracts((current) =>
      current.map((contract) =>
        contract.id === contractId ? update(contract) : contract,
      ),
    );
    setSelected((current) =>
      current?.id === contractId ? update(current) : current,
    );
    setNotice("New milestone added. Fund it when you are ready to begin.");
  };
  const finishContract = async (
    contract: ClientContract,
    input: { rating: number; comment: string },
  ) => {
    const token = await getToken();
    const response = await fetch(
      `${process.env.NEXT_PUBLIC_SERVER_URI}/contracts/${contract.id}/finish?role=client`,
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
    await queryClient.invalidateQueries({ queryKey: ["client-contracts"] });
    setNotice(result.message);
  };
  return (
    <>
      <div>
        <p className="text-xs font-semibold tracking-[.14em] text-[#62805f] uppercase">
          Delivery
        </p>
        <h1 className="mt-2 text-3xl font-semibold tracking-[-.045em] sm:text-4xl">
          Contracts
        </h1>
        <p className="mt-2 text-sm text-[#72776f]">
          Track fixed-price work, funding, and milestone approvals.
        </p>
      </div>
      {notice && (
        <p className="mt-5 rounded-xl bg-[#e7f2e4] p-3 text-xs font-semibold text-[#4d784a]">
          {notice}
        </p>
      )}
      <section className="mt-8 grid gap-4 sm:grid-cols-3">
        <Summary
          label="Active contracts"
          value={String(
            contracts.filter((contract) => contract.status === "Active").length,
          )}
        />
        <Summary
          label="Currently in progress"
          value={`$${contracts.reduce((total, contract) => total + contract.escrow, 0).toLocaleString()}`}
        />
        <Summary
          label="Paid"
          value={`$${contracts.reduce((total, contract) => total + contract.paid, 0).toLocaleString()}`}
        />
      </section>
      <div className="mt-6 grid gap-4">
        {isLoading && <ContractsSkeleton />}
        {contracts.map((contract) => (
          <article
            key={contract.id}
            className="rounded-2xl border border-black/8 bg-white p-5 sm:p-6"
          >
            <div className="flex flex-col justify-between gap-4 sm:flex-row">
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <span
                    className={`rounded-full px-2.5 py-1 text-[10px] font-semibold ${contract.status === "Awaiting approval" ? "bg-[#f5eed4] text-[#806d31]" : "bg-[#e7f2e4] text-[#4d784a]"}`}
                  >
                    {contract.status}
                  </span>
                  <span className="text-[10px] text-[#8a8f87]">
                    Started {contract.started}
                  </span>
                </div>
                <h2 className="mt-3 text-lg font-semibold">{contract.title}</h2>
                <p className="mt-2 text-xs text-[#747a72]">
                  {contract.talent} · {contract.accountType}
                </p>
              </div>
              <div className="flex gap-2">
                <Link
                  href={`/messages?conversationId=${data?.find(({ id }) => id === contract.id)?.conversationId ?? ""}`}
                  className="h-10 rounded-xl border border-black/10 px-4 py-3 text-xs font-semibold"
                >
                  Message
                </Link>
                <button
                  type="button"
                  onClick={() => {
                    router.push(`/contracts?contractId=${contract.id}`);
                  }}
                  className="h-10 cursor-pointer rounded-xl bg-[#252724] px-4 text-xs font-semibold text-white"
                >
                  View contract
                </button>
                {contract.status === "Completed" &&
                  !contract.reviewedByCurrentUser && (
                    <button
                      type="button"
                      onClick={() => setReviewTarget(contract)}
                      className="h-10 cursor-pointer rounded-xl border border-black/10 px-4 text-xs font-semibold"
                    >
                      Give review
                    </button>
                  )}
              </div>
            </div>
            <div className="mt-5 grid gap-4 sm:grid-cols-4">
              <ContractMetric
                label="Total budget"
                value={`$${contract.totalBudget.toLocaleString()}`}
              />
              <ContractMetric
                label="Paid"
                value={`$${contract.paid.toLocaleString()}`}
              />
              <ContractMetric
                label="In progress"
                value={`$${contract.escrow.toLocaleString()}`}
              />
              <ContractMetric
                label="Next deadline"
                value={contract.nextDeadline}
              />
            </div>
            <div className="mt-5">
              <div className="flex justify-between text-[10px] text-[#7b8078]">
                <span>Contract progress</span>
                <span>{contract.progress}%</span>
              </div>
              <div className="mt-2 h-1.5 rounded-full bg-[#e4e8e1]">
                <div
                  className="h-full rounded-full bg-[#658a62]"
                  style={{ width: `${contract.progress}%` }}
                />
              </div>
            </div>
          </article>
        ))}
        {!isLoading && !contracts.length && (
          <div className="rounded-2xl border border-dashed border-black/10 bg-white p-10 text-center text-sm text-[#72776f]">
            No contracts yet.
          </div>
        )}
      </div>
      {selected && (
        <ContractDrawer
          contract={selected}
          onClose={() => {
            setSelected(null);
            router.replace("/contracts");
          }}
          onApprove={approve}
          onRequestChanges={requestChanges}
          onActivateMilestone={activateMilestone}
          onAddMilestone={addMilestone}
          onFinish={() => setReviewTarget(selected)}
        />
      )}
      {reviewTarget && (
        <ContractReviewModal
          contract={reviewTarget}
          onClose={() => setReviewTarget(null)}
          onSubmit={(input) => finishContract(reviewTarget, input)}
        />
      )}
    </>
  );
}
function Summary({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-black/8 bg-white p-5">
      <p className="text-xs text-[#7b8078]">{label}</p>
      <p className="mt-2 text-2xl font-semibold">{value}</p>
    </div>
  );
}

function ContractsSkeleton() {
  return (
    <div className="animate-pulse rounded-2xl border border-black/8 bg-white p-6">
      <div className="h-5 w-28 rounded bg-[#e8ebe6]" />
      <div className="mt-4 h-6 w-64 rounded bg-[#e8ebe6]" />
      <div className="mt-6 grid gap-4 sm:grid-cols-4">
        {[0, 1, 2, 3].map((item) => (
          <div key={item} className="h-16 rounded-xl bg-[#f0f2ee]" />
        ))}
      </div>
    </div>
  );
}

function ContractMetric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl bg-[#f3f5f1] p-3">
      <p className="text-[9px] text-[#858a82]">{label}</p>
      <p className="mt-1 text-xs font-semibold">{value}</p>
    </div>
  );
}
function ContractDrawer({
  contract,
  onClose,
  onApprove,
  onRequestChanges,
  onActivateMilestone,
  onAddMilestone,
  onFinish,
}: {
  contract: ClientContract;
  onClose: () => void;
  onApprove: (
    contractId: ClientContract["id"],
    milestoneId: ClientContract["milestones"][number]["id"],
  ) => void;
  onRequestChanges: (
    contractId: ClientContract["id"],
    milestoneId: ClientContract["milestones"][number]["id"],
    feedback: string,
  ) => void;
  onActivateMilestone: (
    contractId: ClientContract["id"],
    milestoneId: ClientContract["milestones"][number]["id"],
    requirements: string,
  ) => Promise<void>;
  onAddMilestone: (
    contractId: ClientContract["id"],
    input: { title: string; amount: number; dueDate: string },
  ) => Promise<void>;
  onFinish: () => void;
}) {
  const [decision, setDecision] = useState<{
    type: "changes" | "approve" | "activate";
    milestone: ClientContract["milestones"][number];
  } | null>(null);
  const [addingMilestone, setAddingMilestone] = useState(false);
  const allMilestonesCompleted =
    contract.status === "Active" &&
    contract.milestones.length > 0 &&
    contract.milestones.every((milestone) => milestone.status === "Paid");

  return (
    <div
      className="fixed inset-0 z-50 bg-black/25"
      onMouseDown={(event) => event.target === event.currentTarget && onClose()}
    >
      <aside className="absolute top-0 right-0 h-full w-full max-w-2xl overflow-y-auto bg-white p-5 sm:p-7">
        <div className="flex justify-between gap-4">
          <div>
            <p className="text-xs font-semibold text-[#62805f]">
              {contract.accountType} contract
            </p>
            <h2 className="mt-2 text-2xl font-semibold">{contract.title}</h2>
            <p className="mt-1 text-sm text-[#747a72]">{contract.talent}</p>
          </div>
          <button type="button" onClick={onClose} className="cursor-pointer">
            <Icon icon="solar:close-circle-linear" width="24" />
          </button>
        </div>
        <p className="mt-6 text-sm leading-7 text-[#686e66]">
          {contract.description}
        </p>
        <MilestoneProgress contract={contract} />
        <div className="mt-4 flex gap-3 rounded-xl border border-[#d3e1cf] bg-[#edf4ea] p-4">
          <Icon
            icon="solar:shield-check-linear"
            width="20"
            className="shrink-0 text-[#52784f]"
          />
          <div>
            <p className="text-xs font-semibold text-[#486d45]">
              Milestone payment protection
            </p>
            <p className="mt-1 text-[10px] leading-5 text-[#637061]">
              Funded payments remain protected until milestones are approved. We
              release payment to the freelancer only after the work is submitted
              and you confirm that the milestone is complete.
            </p>
          </div>
        </div>
        <h3 className="mt-7 text-sm font-semibold">Milestone details</h3>
        <div className="mt-3 grid gap-3">
          {contract.milestones.map((milestone, index) => {
            const tone = milestoneTone(milestone.status);
            const canActivate =
              milestone.status === "Upcoming" &&
              contract.milestones
                .slice(0, index)
                .every((previous) => previous.status === "Paid") &&
              !contract.milestones.some(
                (item) =>
                  item.status === "In progress" || item.status === "Submitted",
              );

            return (
              <article
                key={milestone.id}
                className={`rounded-xl border p-4 transition-colors ${tone.card}`}
              >
                <div className="flex justify-between gap-4">
                  <div className="flex min-w-0 gap-3">
                    <span
                      className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[10px] font-semibold ${tone.marker}`}
                    >
                      {milestone.status === "Paid" ? (
                        <Icon icon="solar:check-read-linear" width="15" />
                      ) : (
                        index + 1
                      )}
                    </span>
                    <div>
                      <p className="text-xs font-semibold">{milestone.title}</p>
                      <p className="mt-1 text-[10px] text-[#858a82]">
                        Due {milestone.due}
                      </p>
                    </div>
                  </div>
                  <div className="shrink-0 text-right">
                    <p className="text-xs font-semibold">
                      ${milestone.amount.toLocaleString()}
                    </p>
                    <p className="mt-1 text-[10px] text-[#858a82]">
                      <span
                        className={`inline-flex rounded-full px-2 py-1 font-semibold ${tone.badge}`}
                      >
                        {milestone.status}
                      </span>
                    </p>
                  </div>
                </div>
                {milestone.status === "Submitted" &&
                  milestone.submissionComment && (
                    <div className="mt-4 rounded-xl bg-white/80 p-3">
                      <p className="flex items-center gap-1.5 text-[9px] font-semibold tracking-wide text-[#70806d] uppercase">
                        <Icon icon="solar:letter-linear" width="14" />
                        Freelancer submission comment
                      </p>
                      <p className="mt-2 text-[11px] leading-5 text-[#616860]">
                        {milestone.submissionComment}
                      </p>
                    </div>
                  )}
                {milestone.status === "Submitted" && (
                  <div className="mt-4 flex justify-end gap-2 border-t border-black/7 pt-4">
                    <button
                      type="button"
                      onClick={() =>
                        setDecision({ type: "changes", milestone })
                      }
                      className="h-9 cursor-pointer rounded-lg border border-black/10 px-3 text-xs font-semibold"
                    >
                      Request changes
                    </button>
                    <button
                      type="button"
                      onClick={() =>
                        setDecision({ type: "approve", milestone })
                      }
                      className="h-9 cursor-pointer rounded-lg bg-[#252724] px-3 text-xs font-semibold text-white"
                    >
                      Approve & release
                    </button>
                  </div>
                )}
                {canActivate && (
                  <div className="mt-4 flex flex-col justify-between gap-3 border-t border-black/7 pt-4 sm:flex-row sm:items-center">
                    <p className="text-[10px] leading-5 text-[#747b72]">
                      Previous work is complete. Fund this milestone to begin
                      the next phase.
                    </p>
                    <button
                      type="button"
                      onClick={() =>
                        setDecision({ type: "activate", milestone })
                      }
                      className="h-9 shrink-0 cursor-pointer rounded-lg bg-[#52784f] px-3 text-xs font-semibold text-white"
                    >
                      Activate milestone
                    </button>
                  </div>
                )}
              </article>
            );
          })}
        </div>
        {allMilestonesCompleted && (
          <div className="mt-6 flex justify-end gap-2 border-t border-black/8 pt-5">
            <button
              type="button"
              onClick={onFinish}
              className="h-10 cursor-pointer rounded-xl border border-black/10 px-4 text-xs font-semibold"
            >
              Finish contract
            </button>
            <button
              type="button"
              onClick={() => setAddingMilestone(true)}
              className="h-10 cursor-pointer rounded-xl bg-[#252724] px-4 text-xs font-semibold text-white"
            >
              Add milestone
            </button>
          </div>
        )}
        {contract.status === "Completed" && !contract.reviewedByCurrentUser && (
          <div className="mt-6 flex justify-end border-t border-black/8 pt-5">
            <button
              type="button"
              onClick={onFinish}
              className="h-10 cursor-pointer rounded-xl bg-[#252724] px-4 text-xs font-semibold text-white"
            >
              Give review
            </button>
          </div>
        )}
      </aside>
      {decision && (
        <MilestoneDecisionModal
          contract={contract}
          decision={decision}
          onClose={() => setDecision(null)}
          onApprove={() => onApprove(contract.id, decision.milestone.id)}
          onRequestChanges={(feedback) =>
            onRequestChanges(contract.id, decision.milestone.id, feedback)
          }
          onActivateMilestone={(requirements) =>
            onActivateMilestone(
              contract.id,
              decision.milestone.id,
              requirements,
            )
          }
        />
      )}
      {addingMilestone && (
        <AddMilestoneModal
          onClose={() => setAddingMilestone(false)}
          onSubmit={(input) => onAddMilestone(contract.id, input)}
        />
      )}
    </div>
  );
}

function ContractReviewModal({
  contract,
  onClose,
  onSubmit,
}: {
  contract: ClientContract;
  onClose: () => void;
  onSubmit: (input: { rating: number; comment: string }) => Promise<void>;
}) {
  const [rating, setRating] = useState(0);
  const [comment, setComment] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  return (
    <div className="fixed inset-0 z-80 grid place-items-center bg-[#172018]/50 p-5 backdrop-blur-sm">
      <form
        className="w-full max-w-md rounded-2xl bg-white p-6 shadow-2xl"
        onSubmit={(event) => {
          event.preventDefault();
          setSaving(true);
          setError("");
          void onSubmit({ rating, comment: comment.trim() })
            .then(onClose)
            .catch((error) => {
              setError(
                error instanceof Error
                  ? error.message
                  : "Review could not be submitted.",
              );
              setSaving(false);
            });
        }}
      >
        <div className="flex items-start justify-between gap-4">
          <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-[#edf4ea] text-[#52784f]">
            <Icon icon="solar:star-bold" width="22" />
          </span>
          <button
            type="button"
            onClick={onClose}
            disabled={saving}
            aria-label="Close review modal"
          >
            <Icon icon="solar:close-circle-linear" width="23" />
          </button>
        </div>
        <h2 className="mt-4 text-xl font-semibold">Review {contract.talent}</h2>
        <p className="mt-2 text-sm text-[#737970]">
          Share your experience from “{contract.title}”. A review is required to
          finish the contract.
        </p>
        <div className="mt-5 flex gap-1" aria-label="Rating">
          {[1, 2, 3, 4, 5].map((value) => (
            <button
              key={value}
              type="button"
              onClick={() => setRating(value)}
              className={value <= rating ? "text-[#d5a62e]" : "text-[#d9ddd7]"}
              aria-label={`${value} stars`}
            >
              <Icon icon="solar:star-bold" width="30" />
            </button>
          ))}
        </div>
        <textarea
          required
          minLength={10}
          maxLength={1000}
          rows={5}
          value={comment}
          onChange={(event) => setComment(event.target.value)}
          placeholder="Write your review..."
          className="mt-5 w-full resize-none rounded-xl border border-black/10 p-3 text-sm outline-none focus:border-[#6e916a]"
        />
        {error && <p className="mt-3 text-xs text-red-600">{error}</p>}
        <div className="mt-6 flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            disabled={saving}
            className="h-10 rounded-xl border border-black/10 px-4 text-xs font-semibold"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={saving || rating === 0 || comment.trim().length < 10}
            className="h-10 rounded-xl bg-[#252724] px-4 text-xs font-semibold text-white disabled:opacity-40"
          >
            {saving
              ? "Submitting…"
              : contract.status === "Completed"
                ? "Submit review"
                : "Finish contract"}
          </button>
        </div>
      </form>
    </div>
  );
}

function AddMilestoneModal({
  onClose,
  onSubmit,
}: {
  onClose: () => void;
  onSubmit: (input: {
    title: string;
    amount: number;
    dueDate: string;
  }) => Promise<void>;
}) {
  const [title, setTitle] = useState("");
  const [amount, setAmount] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const today = new Date();
  const minimumDueDate = [
    today.getFullYear(),
    String(today.getMonth() + 1).padStart(2, "0"),
    String(today.getDate()).padStart(2, "0"),
  ].join("-");

  return (
    <div className="fixed inset-0 z-70 grid place-items-center bg-[#172018]/50 p-5 backdrop-blur-[3px]">
      <form
        className="w-full max-w-md rounded-2xl bg-white p-6 shadow-2xl"
        onSubmit={(event) => {
          event.preventDefault();
          setSaving(true);
          setError("");
          void onSubmit({
            title: title.trim(),
            amount: Number(amount),
            dueDate,
          })
            .then(onClose)
            .catch((error) => {
              setError(
                error instanceof Error
                  ? error.message
                  : "Milestone could not be added.",
              );
              setSaving(false);
            });
        }}
      >
        <ModalHeading
          eyebrow="Contract extension"
          title="Add another milestone"
          onClose={onClose}
        />
        <label className="mt-5 block text-xs font-semibold">
          Milestone title
          <input
            required
            minLength={3}
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            className="mt-2 h-11 w-full rounded-xl border border-black/10 px-3 text-sm font-normal outline-none focus:border-[#6e916a]"
          />
        </label>
        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <label className="text-xs font-semibold">
            Amount
            <input
              required
              type="number"
              min="10"
              step="0.01"
              value={amount}
              onChange={(event) => setAmount(event.target.value)}
              className="mt-2 h-11 w-full rounded-xl border border-black/10 px-3 text-sm font-normal outline-none focus:border-[#6e916a]"
            />
          </label>
          <label className="text-xs font-semibold">
            Due date
            <input
              required
              type="date"
              min={minimumDueDate}
              value={dueDate}
              onChange={(event) => setDueDate(event.target.value)}
              className="mt-2 h-11 w-full rounded-xl border border-black/10 px-3 text-sm font-normal outline-none focus:border-[#6e916a]"
            />
          </label>
        </div>
        {error && <p className="mt-3 text-xs text-[#a65050]">{error}</p>}
        <div className="mt-6 flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            disabled={saving}
            className="h-10 rounded-xl border border-black/10 px-4 text-xs font-semibold"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={saving || !title.trim() || !amount || !dueDate}
            className="h-10 rounded-xl bg-[#252724] px-4 text-xs font-semibold text-white disabled:opacity-45"
          >
            {saving ? "Adding…" : "Add milestone"}
          </button>
        </div>
      </form>
    </div>
  );
}

function MilestoneDecisionModal({
  contract,
  decision,
  onClose,
  onApprove,
  onRequestChanges,
  onActivateMilestone,
}: {
  contract: ClientContract;
  decision: {
    type: "changes" | "approve" | "activate";
    milestone: ClientContract["milestones"][number];
  };
  onClose: () => void;
  onApprove: () => void;
  onRequestChanges: (feedback: string) => void;
  onActivateMilestone: (requirements: string) => Promise<void>;
}) {
  const [feedback, setFeedback] = useState("");
  const [requirements, setRequirements] = useState("");
  const [error, setError] = useState("");
  const [funding, setFunding] = useState(false);
  const requestingChanges = decision.type === "changes";
  const activating = decision.type === "activate";

  const submitChanges = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const normalizedFeedback = feedback.trim();
    if (normalizedFeedback.length < 10) {
      setError(
        "Please describe the requested update in at least 10 characters.",
      );
      return;
    }
    onRequestChanges(normalizedFeedback);
  };

  return (
    <div
      className="fixed inset-0 z-60 grid place-items-center bg-[#172018]/50 p-5 backdrop-blur-[3px]"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      {requestingChanges ? (
        <form
          onSubmit={submitChanges}
          className="w-full max-w-lg rounded-2xl bg-white p-6 shadow-2xl sm:p-7"
        >
          <ModalHeading
            eyebrow="Revision request"
            title="What needs to be updated?"
            onClose={onClose}
          />
          <MilestoneSummary
            title={decision.milestone.title}
            amount={decision.milestone.amount}
          />
          <label className="mt-5 block text-xs font-semibold">
            Changes requested <span className="text-[#a04d4d]">*</span>
            <textarea
              value={feedback}
              onChange={(event) => {
                setFeedback(event.target.value);
                if (error) setError("");
              }}
              rows={5}
              placeholder="Explain what should change, why it matters, and what you expect in the next submission…"
              aria-invalid={Boolean(error)}
              className={`mt-2 w-full resize-none rounded-xl border p-3 text-sm font-normal outline-none ${
                error
                  ? "border-[#c56b6b] focus:border-[#c56b6b]"
                  : "border-black/10 focus:border-[#6e916a]"
              }`}
            />
          </label>
          {error && (
            <p className="mt-2 text-[10px] font-medium text-[#a65050]">
              {error}
            </p>
          )}
          <p className="mt-3 text-[10px] leading-5 text-[#7b8179]">
            This feedback will be sent to {contract.talent}, and the milestone
            will return to In progress.
          </p>
          <div className="mt-6 flex justify-end gap-2">
            <button
              type="button"
              onClick={onClose}
              className="h-11 cursor-pointer rounded-xl border border-black/10 px-5 text-xs font-semibold"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={!feedback.trim()}
              className="h-11 cursor-pointer rounded-xl bg-[#252724] px-5 text-xs font-semibold text-white disabled:cursor-not-allowed disabled:opacity-40"
            >
              Send revision request
            </button>
          </div>
        </form>
      ) : activating ? (
        <section className="w-full max-w-lg rounded-2xl bg-white p-6 shadow-2xl sm:p-7">
          <ModalHeading
            eyebrow="Secure milestone funding"
            title="Fund and activate milestone"
            onClose={onClose}
          />
          <MilestoneSummary
            title={decision.milestone.title}
            amount={decision.milestone.amount}
          />

          <div className="mt-5 rounded-xl border border-black/8 p-4">
            <div className="flex items-center justify-between gap-4">
              <div className="flex items-center gap-3">
                <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-[#edf4ea] text-[#52784f]">
                  <Icon icon="solar:card-linear" width="19" />
                </span>
                <div>
                  <p className="text-xs font-semibold">Milestone payment</p>
                  <p className="mt-1 text-[9px] text-[#81877f]">
                    Continue to secure checkout
                  </p>
                </div>
              </div>
              <strong className="text-sm">
                ${decision.milestone.amount.toLocaleString()}
              </strong>
            </div>
          </div>

          <label className="mt-5 block text-xs font-semibold">
            Additional requirements{" "}
            <span className="font-normal text-[#8a8f87]">(optional)</span>
            <textarea
              value={requirements}
              onChange={(event) => setRequirements(event.target.value)}
              rows={4}
              placeholder="Add any updated instructions, priorities, links, or acceptance requirements for this milestone…"
              className="mt-2 w-full resize-none rounded-xl border border-black/10 p-3 text-sm font-normal outline-none focus:border-[#6e916a]"
            />
          </label>

          <div className="mt-4 flex gap-3 rounded-xl border border-[#d3e1cf] bg-[#edf4ea] p-4">
            <Icon
              icon="solar:shield-check-linear"
              width="21"
              className="shrink-0 text-[#52784f]"
            />
            <p className="text-[10px] leading-5 text-[#5c6b59]">
              Your payment stays protected until it's released. It will not be
              released to {contract.talent} until work is submitted and you
              approve the completed milestone.
            </p>
          </div>

          <div className="mt-6 flex justify-end gap-2">
            <button
              type="button"
              onClick={onClose}
              className="h-11 cursor-pointer rounded-xl border border-black/10 px-5 text-xs font-semibold"
            >
              Cancel
            </button>
            <button
              type="button"
              disabled={funding}
              onClick={() => {
                setFunding(true);
                setError("");
                void onActivateMilestone(requirements.trim()).catch((error) => {
                  setError(
                    error instanceof Error
                      ? error.message
                      : "Milestone checkout could not start.",
                  );
                  setFunding(false);
                });
              }}
              className="h-11 cursor-pointer rounded-xl bg-[#252724] px-5 text-xs font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50"
            >
              {funding ? "Opening checkout…" : "Fund & activate"}
            </button>
          </div>
          {error && <p className="mt-3 text-xs text-[#a65050]">{error}</p>}
        </section>
      ) : (
        <section className="w-full max-w-md rounded-2xl bg-white p-6 shadow-2xl sm:p-7">
          <ModalHeading
            eyebrow="Payment release"
            title="Approve this milestone?"
            onClose={onClose}
          />
          <MilestoneSummary
            title={decision.milestone.title}
            amount={decision.milestone.amount}
          />
          <div className="mt-5 rounded-xl border border-[#d6e3d2] bg-[#edf4ea] p-4">
            <div className="flex gap-3">
              <Icon
                icon="solar:wallet-money-linear"
                width="21"
                className="shrink-0 text-[#52784f]"
              />
              <p className="text-xs leading-5 text-[#536250]">
                Approving will release{" "}
                <strong>${decision.milestone.amount.toLocaleString()}</strong>{" "}
                to {contract.talent} and permanently mark this milestone as
                completed.
              </p>
            </div>
          </div>
          <p className="mt-4 text-xs leading-5 text-[#737970]">
            Confirm only after you have reviewed the submitted work and are
            satisfied that it meets the milestone requirements.
          </p>
          <div className="mt-6 grid gap-2 sm:grid-cols-2">
            <button
              type="button"
              onClick={onClose}
              className="h-11 cursor-pointer rounded-xl border border-black/10 px-4 text-xs font-semibold"
            >
              Keep reviewing
            </button>
            <button
              type="button"
              onClick={onApprove}
              className="h-11 cursor-pointer rounded-xl bg-[#252724] px-4 text-xs font-semibold text-white"
            >
              Yes, approve & release
            </button>
          </div>
        </section>
      )}
    </div>
  );
}

function ModalHeading({
  eyebrow,
  title,
  onClose,
}: {
  eyebrow: string;
  title: string;
  onClose: () => void;
}) {
  return (
    <div className="flex items-start justify-between gap-4">
      <div>
        <p className="text-[10px] font-semibold tracking-[.12em] text-[#62805f] uppercase">
          {eyebrow}
        </p>
        <h2 className="mt-2 text-xl font-semibold">{title}</h2>
      </div>
      <button
        type="button"
        onClick={onClose}
        aria-label="Close modal"
        className="cursor-pointer text-[#697067]"
      >
        <Icon icon="solar:close-circle-linear" width="24" />
      </button>
    </div>
  );
}

function MilestoneSummary({
  title,
  amount,
}: {
  title: string;
  amount: number;
}) {
  return (
    <div className="mt-5 flex items-center justify-between gap-4 rounded-xl bg-[#f2f5f0] p-4">
      <div>
        <p className="text-[9px] text-[#7b8179]">Milestone</p>
        <p className="mt-1 text-xs font-semibold">{title}</p>
      </div>
      <strong className="text-sm">${amount.toLocaleString()}</strong>
    </div>
  );
}

function MilestoneProgress({ contract }: { contract: ClientContract }) {
  const paidMilestones = contract.milestones.filter(
    (milestone) => milestone.status === "Paid",
  );
  const paidAmount = paidMilestones.reduce(
    (total, milestone) => total + milestone.amount,
    0,
  );
  const completion = Math.round((paidAmount / contract.totalBudget) * 100);

  return (
    <section className="mt-7 rounded-2xl border border-black/7 bg-[#f7f9f5] p-4 sm:p-5">
      <div className="flex items-end justify-between gap-4">
        <div>
          <p className="text-xs font-semibold">Contract completion</p>
          <p className="mt-1 text-[10px] text-[#7b8179]">
            {paidMilestones.length} of {contract.milestones.length} milestones
            completed
          </p>
        </div>
        <strong className="text-xl text-[#52784f]">{completion}%</strong>
      </div>

      <div className="mt-4 flex h-2 gap-1 overflow-hidden rounded-full bg-[#e4e8e1]">
        {contract.milestones.map((milestone) => (
          <span
            key={milestone.id}
            title={`${milestone.title}: ${milestone.status}`}
            className={`h-full transition-colors ${milestoneTone(milestone.status).bar}`}
            style={{
              width: `${(milestone.amount / contract.totalBudget) * 100}%`,
            }}
          />
        ))}
      </div>

      <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
        {contract.milestones.map((milestone, index) => {
          const tone = milestoneTone(milestone.status);
          return (
            <div key={milestone.id} className="min-w-0">
              <div className="flex items-center gap-1.5">
                <span className={`h-2 w-2 shrink-0 rounded-full ${tone.dot}`} />
                <span className="truncate text-[9px] font-semibold">
                  {index + 1}. {milestone.title}
                </span>
              </div>
              <p className={`mt-1 pl-3.5 text-[9px] ${tone.text}`}>
                {milestone.status}
              </p>
            </div>
          );
        })}
      </div>
    </section>
  );
}

function milestoneTone(status: ClientContract["milestones"][number]["status"]) {
  switch (status) {
    case "Paid":
      return {
        bar: "bg-[#5e8b5a]",
        dot: "bg-[#5e8b5a]",
        text: "text-[#52784f]",
        marker: "bg-[#e3f0df] text-[#52784f]",
        badge: "bg-[#e3f0df] text-[#52784f]",
        card: "border-[#cadcc6] bg-[#fbfdf9]",
      };
    case "Submitted":
      return {
        bar: "bg-[#c1a34d]",
        dot: "bg-[#c1a34d]",
        text: "text-[#826d2f]",
        marker: "bg-[#f5eed4] text-[#806d31]",
        badge: "bg-[#f5eed4] text-[#806d31]",
        card: "border-[#e2d7ad] bg-[#fffdf7]",
      };
    case "In progress":
      return {
        bar: "bg-[#6f91a3]",
        dot: "bg-[#6f91a3]",
        text: "text-[#58788a]",
        marker: "bg-[#e5eef3] text-[#58788a]",
        badge: "bg-[#e5eef3] text-[#58788a]",
        card: "border-[#ccdae1] bg-[#fbfdfe]",
      };
    default:
      return {
        bar: "bg-[#d9ddd6]",
        dot: "bg-[#c8cdc5]",
        text: "text-[#8a9088]",
        marker: "bg-[#eef0ec] text-[#777e75]",
        badge: "bg-[#eef0ec] text-[#777e75]",
        card: "border-black/7 bg-white",
      };
  }
}

function updateApprovedMilestone(
  contract: ClientContract,
  milestoneId: ClientContract["milestones"][number]["id"],
): ClientContract {
  const approvedMilestone = contract.milestones.find(
    (milestone) => milestone.id === milestoneId,
  );
  if (!approvedMilestone || approvedMilestone.status === "Paid") {
    return contract;
  }

  const milestones = contract.milestones.map((milestone) =>
    milestone.id === milestoneId
      ? { ...milestone, status: "Paid" as const }
      : milestone,
  );
  const paid = milestones
    .filter((milestone) => milestone.status === "Paid")
    .reduce((total, milestone) => total + milestone.amount, 0);

  return {
    ...contract,
    status: milestones.every((milestone) => milestone.status === "Paid")
      ? "Completed"
      : "Active",
    milestones,
    paid,
    escrow: Math.max(contract.escrow - approvedMilestone.amount, 0),
    progress: Math.round((paid / contract.totalBudget) * 100),
  };
}
