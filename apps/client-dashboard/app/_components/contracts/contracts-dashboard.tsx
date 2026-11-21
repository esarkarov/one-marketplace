"use client";

import { Icon } from "@iconify/react";
import { formatCents } from "@onemarketplace/api-client";
import {
  contractErrorMessage,
  contractErrorMessageOf,
  contractTotals,
  isHttpsUrl,
  milestoneState,
  nextDeadline,
  startedAt,
  sumContractTotals,
  type ContractItem,
  type MilestoneItem,
  type MilestoneState,
} from "@onemarketplace/web-core";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import {
  useAddMilestone,
  useApproveMilestone,
  useContracts,
  useFinishContract,
  useFundMilestone,
  useRequestMilestoneChanges,
  useWithdrawContract,
} from "@/app/hooks/use-contracts";
import {
  MILESTONE_AMOUNT_HINT,
  canAddMilestone,
  canFinishContract,
  canFundMilestone,
  canGiveReview,
  canReviewMilestone,
  canWithdrawContract,
  contractStatusLabel,
  contractStatusTone,
  counterpartyLabel,
  findContract,
  formatDueDate,
  messagesLink,
  milestoneLabel,
  todayLocalDate,
  validateAddMilestone,
  validateContractReview,
  validateFeedback,
  validateRequirements,
  type ContractTone,
} from "@/lib/contracts";

type Decision = {
  type: "changes" | "approve" | "activate";
  milestone: MilestoneItem;
};

const statusBadgeClass: Record<ContractTone, string> = {
  pending: "bg-[#f5eed4] text-[#806d31]",
  active: "bg-[#e7f2e4] text-[#4d784a]",
  completed: "bg-[#e5eef3] text-[#58788a]",
  cancelled: "bg-[#f6e3e3] text-[#a04d4d]",
  unknown: "bg-[#eef0ec] text-[#777e75]",
};

export function ContractsDashboard() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [page, setPage] = useState(0);
  const [notice, setNotice] = useState("");
  const [reviewTarget, setReviewTarget] = useState<ContractItem | null>(null);
  const [withdrawTarget, setWithdrawTarget] = useState<ContractItem | null>(
    null,
  );
  const { data, isLoading, isFetching, error } = useContracts(page);
  const contracts = data?.results ?? [];
  const contractIdParam = searchParams.get("contractId");
  const selected = findContract(contracts, contractIdParam);
  const totals = sumContractTotals(contracts);

  useEffect(() => {
    if (!notice) return;
    const timeout = window.setTimeout(() => setNotice(""), 3500);
    return () => window.clearTimeout(timeout);
  }, [notice]);

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
        <p
          role="status"
          className="mt-5 rounded-xl bg-[#e7f2e4] p-3 text-xs font-semibold text-[#4d784a]"
        >
          {notice}
        </p>
      )}
      {error && (
        <p
          role="alert"
          className="mt-5 rounded-xl bg-[#f6e3e3] p-3 text-xs font-semibold text-[#a04d4d]"
        >
          {contractErrorMessage(error)}
        </p>
      )}
      {contractIdParam && !selected && !isLoading && !error && (
        <p className="mt-5 rounded-xl bg-[#f5eed4] p-3 text-xs font-semibold text-[#806d31]">
          That contract is not on this page of results.
          {data?.hasMore ? " Use Next to look further." : ""}
        </p>
      )}
      <section className="mt-8 grid gap-4 sm:grid-cols-3">
        <Summary label="Active contracts" value={String(totals.activeCount)} />
        <Summary
          label="Currently in progress"
          value={formatCents(totals.escrowCents)}
        />
        <Summary label="Paid" value={formatCents(totals.paidCents)} />
      </section>
      <div className="mt-6 grid gap-4">
        {isLoading && <ContractsSkeleton />}
        {contracts.map((contract) => {
          const totalsForContract = contractTotals(contract);
          const deadline = nextDeadline(contract);
          const chat = messagesLink(contract.conversationId);
          return (
            <article
              key={contract.id}
              className="rounded-2xl border border-black/8 bg-white p-5 sm:p-6"
            >
              <div className="flex flex-col justify-between gap-4 sm:flex-row">
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <span
                      className={`rounded-full px-2.5 py-1 text-[10px] font-semibold ${statusBadgeClass[contractStatusTone(contract.status)]}`}
                    >
                      {contractStatusLabel(contract.status)}
                    </span>
                    <span className="text-[10px] text-[#8a8f87]">
                      Started {formatDueDate(startedAt(contract))}
                    </span>
                  </div>
                  <h2 className="mt-3 text-lg font-semibold">
                    {contract.title}
                  </h2>
                  <p className="mt-2 text-xs text-[#747a72]">
                    {contract.counterpartyName} ·{" "}
                    {counterpartyLabel(contract.counterpartyType)}
                  </p>
                </div>
                <div className="flex flex-wrap gap-2">
                  {chat && (
                    <Link
                      href={chat}
                      className="h-10 rounded-xl border border-black/10 px-4 py-3 text-xs font-semibold"
                    >
                      Message
                    </Link>
                  )}
                  <button
                    type="button"
                    onClick={() =>
                      router.push(
                        `/contracts?contractId=${encodeURIComponent(contract.id)}`,
                      )
                    }
                    className="h-10 cursor-pointer rounded-xl bg-[#252724] px-4 text-xs font-semibold text-white"
                  >
                    View contract
                  </button>
                  {canWithdrawContract(contract) && (
                    <button
                      type="button"
                      onClick={() => setWithdrawTarget(contract)}
                      className="h-10 cursor-pointer rounded-xl border border-[#e2c4c4] px-4 text-xs font-semibold text-[#a04d4d]"
                    >
                      Withdraw offer
                    </button>
                  )}
                  {canGiveReview(contract) && (
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
                  value={formatCents(totalsForContract.totalCents)}
                />
                <ContractMetric
                  label="Paid"
                  value={formatCents(totalsForContract.paidCents)}
                />
                <ContractMetric
                  label="In progress"
                  value={formatCents(totalsForContract.escrowCents)}
                />
                <ContractMetric
                  label="Next deadline"
                  value={deadline ? formatDueDate(deadline) : "—"}
                />
              </div>
              <div className="mt-5">
                <div className="flex justify-between text-[10px] text-[#7b8078]">
                  <span>Contract progress</span>
                  <span>{totalsForContract.progressPercent}%</span>
                </div>
                <div className="mt-2 h-1.5 rounded-full bg-[#e4e8e1]">
                  <div
                    className="h-full rounded-full bg-[#658a62]"
                    style={{ width: `${totalsForContract.progressPercent}%` }}
                  />
                </div>
              </div>
            </article>
          );
        })}
        {!isLoading && !error && !contracts.length && (
          <div className="rounded-2xl border border-dashed border-black/10 bg-white p-10 text-center text-sm text-[#72776f]">
            {page > 0 ? "No more contracts." : "No contracts yet."}
          </div>
        )}
      </div>
      {(page > 0 || data?.hasMore) && (
        <div className="mt-6 flex items-center justify-between">
          <button
            type="button"
            disabled={page === 0 || isFetching}
            onClick={() => setPage((current) => Math.max(0, current - 1))}
            className="h-10 cursor-pointer rounded-xl border border-black/10 px-4 text-xs font-semibold disabled:cursor-not-allowed disabled:opacity-40"
          >
            Previous
          </button>
          <span className="text-xs text-[#7b8078]">Page {page + 1}</span>
          <button
            type="button"
            disabled={!data?.hasMore || isFetching}
            onClick={() => setPage((current) => current + 1)}
            className="h-10 cursor-pointer rounded-xl border border-black/10 px-4 text-xs font-semibold disabled:cursor-not-allowed disabled:opacity-40"
          >
            Next
          </button>
        </div>
      )}
      {selected && (
        <ContractDrawer
          contract={selected}
          onClose={() => router.replace("/contracts")}
          onNotice={setNotice}
          onFinish={() => setReviewTarget(selected)}
          onWithdraw={() => setWithdrawTarget(selected)}
        />
      )}
      {reviewTarget && (
        <ContractReviewModal
          contract={reviewTarget}
          onClose={() => setReviewTarget(null)}
          onDone={(message) => {
            setReviewTarget(null);
            setNotice(message);
          }}
        />
      )}
      {withdrawTarget && (
        <WithdrawOfferModal
          contract={withdrawTarget}
          onClose={() => setWithdrawTarget(null)}
          onDone={(message) => {
            setWithdrawTarget(null);
            setNotice(message);
            if (contractIdParam === withdrawTarget.id) {
              router.replace("/contracts");
            }
          }}
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
  onNotice,
  onFinish,
  onWithdraw,
}: {
  contract: ContractItem;
  onClose: () => void;
  onNotice: (message: string) => void;
  onFinish: () => void;
  onWithdraw: () => void;
}) {
  const [decision, setDecision] = useState<Decision | null>(null);
  const [addingMilestone, setAddingMilestone] = useState(false);
  const totals = contractTotals(contract);
  const showCompletionActions = canFinishContract(contract);

  return (
    <div
      className="fixed inset-0 z-50 bg-black/25"
      onMouseDown={(event) => event.target === event.currentTarget && onClose()}
    >
      <aside className="absolute top-0 right-0 h-full w-full max-w-2xl overflow-y-auto bg-white p-5 sm:p-7">
        <div className="flex justify-between gap-4">
          <div>
            <p className="text-xs font-semibold text-[#62805f]">
              {counterpartyLabel(contract.counterpartyType)} contract
            </p>
            <h2 className="mt-2 text-2xl font-semibold">{contract.title}</h2>
            <p className="mt-1 text-sm text-[#747a72]">
              {contract.counterpartyName}
            </p>
            <span
              className={`mt-3 inline-flex rounded-full px-2.5 py-1 text-[10px] font-semibold ${statusBadgeClass[contractStatusTone(contract.status)]}`}
            >
              {contractStatusLabel(contract.status)}
            </span>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close contract"
            className="cursor-pointer"
          >
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
            const state = milestoneState(milestone);
            const tone = milestoneTone(state);
            const canActivate = canFundMilestone(contract, index);
            const canReview = canReviewMilestone(contract, milestone);

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
                      {state === "PAID" ? (
                        <Icon icon="solar:check-read-linear" width="15" />
                      ) : (
                        index + 1
                      )}
                    </span>
                    <div>
                      <p className="text-xs font-semibold">{milestone.title}</p>
                      <p className="mt-1 text-[10px] text-[#858a82]">
                        Due {formatDueDate(milestone.dueDate)}
                      </p>
                    </div>
                  </div>
                  <div className="shrink-0 text-right">
                    <p className="text-xs font-semibold">
                      {formatCents(milestone.amountCents)}
                    </p>
                    <p className="mt-1 text-[10px] text-[#858a82]">
                      <span
                        className={`inline-flex rounded-full px-2 py-1 font-semibold ${tone.badge}`}
                      >
                        {milestoneLabel(milestone)}
                      </span>
                    </p>
                  </div>
                </div>
                {state === "SUBMITTED" && (
                  <SubmissionDetails milestone={milestone} />
                )}
                {canReview && (
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
        <p className="mt-4 text-[10px] text-[#858a82]">
          Total {formatCents(totals.totalCents)} · Paid{" "}
          {formatCents(totals.paidCents)} · Funded and in progress{" "}
          {formatCents(totals.escrowCents)}
        </p>
        {showCompletionActions && (
          <div className="mt-6 flex justify-end gap-2 border-t border-black/8 pt-5">
            <button
              type="button"
              onClick={onFinish}
              className="h-10 cursor-pointer rounded-xl border border-black/10 px-4 text-xs font-semibold"
            >
              Finish contract
            </button>
            {canAddMilestone(contract) && (
              <button
                type="button"
                onClick={() => setAddingMilestone(true)}
                className="h-10 cursor-pointer rounded-xl bg-[#252724] px-4 text-xs font-semibold text-white"
              >
                Add milestone
              </button>
            )}
          </div>
        )}
        {canWithdrawContract(contract) && (
          <div className="mt-6 flex justify-end border-t border-black/8 pt-5">
            <button
              type="button"
              onClick={onWithdraw}
              className="h-10 cursor-pointer rounded-xl border border-[#e2c4c4] px-4 text-xs font-semibold text-[#a04d4d]"
            >
              Withdraw offer
            </button>
          </div>
        )}
        {canGiveReview(contract) && (
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
          onDone={(message) => {
            setDecision(null);
            onNotice(message);
          }}
        />
      )}
      {addingMilestone && (
        <AddMilestoneModal
          contractId={contract.id}
          onClose={() => setAddingMilestone(false)}
          onDone={(message) => {
            setAddingMilestone(false);
            onNotice(message);
          }}
        />
      )}
    </div>
  );
}

function SubmissionDetails({ milestone }: { milestone: MilestoneItem }) {
  const link = milestone.submissionDeliveryLink;
  if (!milestone.submissionMessage && !link) return null;
  return (
    <div className="mt-4 rounded-xl bg-white/80 p-3">
      <p className="flex items-center gap-1.5 text-[9px] font-semibold tracking-wide text-[#70806d] uppercase">
        <Icon icon="solar:letter-linear" width="14" />
        Freelancer submission
      </p>
      {milestone.submissionMessage && (
        <p className="mt-2 text-[11px] leading-5 break-words text-[#616860]">
          {milestone.submissionMessage}
        </p>
      )}
      {link &&
        (isHttpsUrl(link) ? (
          <a
            href={link}
            target="_blank"
            rel="noopener noreferrer"
            className="mt-2 inline-block text-[11px] break-all text-[#52784f] underline"
          >
            {link}
          </a>
        ) : (
          <p className="mt-2 text-[11px] break-all text-[#616860]">{link}</p>
        ))}
    </div>
  );
}

function ContractReviewModal({
  contract,
  onClose,
  onDone,
}: {
  contract: ContractItem;
  onClose: () => void;
  onDone: (message: string) => void;
}) {
  const [rating, setRating] = useState(0);
  const [comment, setComment] = useState("");
  const [localError, setLocalError] = useState("");
  const finish = useFinishContract();
  const finishing = contract.status === "ACTIVE";
  const saving = finish.isPending;

  return (
    <div className="fixed inset-0 z-80 grid place-items-center bg-[#172018]/50 p-5 backdrop-blur-sm">
      <form
        className="w-full max-w-md rounded-2xl bg-white p-6 shadow-2xl"
        onSubmit={(event) => {
          event.preventDefault();
          const parsed = validateContractReview({ rating, comment });
          if (!parsed.ok) {
            setLocalError(parsed.message);
            return;
          }
          setLocalError("");
          finish.submit({ contractId: contract.id, ...parsed.value }, () =>
            onDone(
              finishing
                ? "Contract finished. Thanks for your review."
                : "Review submitted.",
            ),
          );
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
        <h2 className="mt-4 text-xl font-semibold">
          Review {contract.counterpartyName}
        </h2>
        <p className="mt-2 text-sm text-[#737970]">
          Share your experience from “{contract.title}”.
          {finishing ? " A review is required to finish the contract." : ""}
        </p>
        <div className="mt-5 flex gap-1" role="group" aria-label="Rating">
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
        <ErrorLine
          message={
            localError ||
            (finish.error ? contractErrorMessage(finish.error) : "")
          }
        />
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
              : finishing
                ? "Finish contract"
                : "Submit review"}
          </button>
        </div>
      </form>
    </div>
  );
}

function AddMilestoneModal({
  contractId,
  onClose,
  onDone,
}: {
  contractId: string;
  onClose: () => void;
  onDone: (message: string) => void;
}) {
  const [title, setTitle] = useState("");
  const [amount, setAmount] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [localError, setLocalError] = useState("");
  const add = useAddMilestone();
  const saving = add.isPending;
  const [minimumDueDate] = useState(() => todayLocalDate());

  return (
    <div className="fixed inset-0 z-70 grid place-items-center bg-[#172018]/50 p-5 backdrop-blur-[3px]">
      <form
        className="w-full max-w-md rounded-2xl bg-white p-6 shadow-2xl"
        onSubmit={(event) => {
          event.preventDefault();
          const parsed = validateAddMilestone(
            { title, amount, dueDate },
            minimumDueDate,
          );
          if (!parsed.ok) {
            setLocalError(parsed.message);
            return;
          }
          setLocalError("");
          add.submit({ contractId, body: parsed.value }, () =>
            onDone("New milestone added. Fund it when you are ready to begin."),
          );
        }}
      >
        <ModalHeading
          eyebrow="Contract extension"
          title="Add another milestone"
          onClose={onClose}
          disabled={saving}
        />
        <label className="mt-5 block text-xs font-semibold">
          Milestone title
          <input
            required
            minLength={3}
            maxLength={120}
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            className="mt-2 h-11 w-full rounded-xl border border-black/10 px-3 text-sm font-normal outline-none focus:border-[#6e916a]"
          />
        </label>
        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <label className="text-xs font-semibold">
            Amount (USD)
            <input
              required
              type="number"
              inputMode="decimal"
              min="10"
              step="0.01"
              value={amount}
              onChange={(event) => setAmount(event.target.value)}
              className="mt-2 h-11 w-full rounded-xl border border-black/10 px-3 text-sm font-normal outline-none focus:border-[#6e916a]"
            />
            <span className="mt-1 block text-[10px] font-normal text-[#858a82]">
              {MILESTONE_AMOUNT_HINT}
            </span>
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
        <ErrorLine
          message={
            localError || (add.error ? contractErrorMessage(add.error) : "")
          }
        />
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

function WithdrawOfferModal({
  contract,
  onClose,
  onDone,
}: {
  contract: ContractItem;
  onClose: () => void;
  onDone: (message: string) => void;
}) {
  const withdraw = useWithdrawContract();
  const working = withdraw.isPending;
  const total = formatCents(contract.totalAmountCents);

  return (
    <div className="fixed inset-0 z-80 grid place-items-center bg-[#172018]/50 p-5 backdrop-blur-[3px]">
      <section
        role="dialog"
        aria-modal="true"
        aria-label="Withdraw offer"
        className="w-full max-w-md rounded-2xl bg-white p-6 shadow-2xl sm:p-7"
      >
        <ModalHeading
          eyebrow="Withdraw offer"
          title="Withdraw this contract offer?"
          onClose={onClose}
          disabled={working}
        />
        <MilestoneSummary
          title={contract.title}
          amountCents={contract.totalAmountCents}
        />
        <p className="mt-4 text-xs leading-5 text-[#737970]">
          The offer to {contract.counterpartyName} is cancelled and the job
          returns to open. The first milestone payment you made at checkout is
          refunded to your card ({total} contract total). This cannot be undone.
        </p>
        <ErrorLine
          message={withdraw.error ? contractErrorMessage(withdraw.error) : ""}
        />
        <div className="mt-6 grid gap-2 sm:grid-cols-2">
          <button
            type="button"
            onClick={onClose}
            disabled={working}
            className="h-11 cursor-pointer rounded-xl border border-black/10 px-4 text-xs font-semibold disabled:opacity-50"
          >
            Keep offer
          </button>
          <button
            type="button"
            disabled={working || withdraw.isSuccess}
            onClick={() =>
              withdraw.submit(contract.id, () =>
                onDone("Offer withdrawn. Your payment is being refunded."),
              )
            }
            className="h-11 cursor-pointer rounded-xl bg-[#a04d4d] px-4 text-xs font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50"
          >
            {working ? "Withdrawing…" : "Yes, withdraw offer"}
          </button>
        </div>
      </section>
    </div>
  );
}

function MilestoneDecisionModal({
  contract,
  decision,
  onClose,
  onDone,
}: {
  contract: ContractItem;
  decision: Decision;
  onClose: () => void;
  onDone: (message: string) => void;
}) {
  const [feedback, setFeedback] = useState("");
  const [requirements, setRequirements] = useState("");
  const [localError, setLocalError] = useState("");
  const approve = useApproveMilestone();
  const requestChanges = useRequestMilestoneChanges();
  const fund = useFundMilestone();
  const requestingChanges = decision.type === "changes";
  const activating = decision.type === "activate";
  const busy =
    approve.isPending ||
    requestChanges.isPending ||
    fund.isPending ||
    fund.isSuccess;
  const apiError = contractErrorMessageOf(
    approve.error ?? requestChanges.error ?? fund.error,
  );
  const target = {
    contractId: contract.id,
    milestoneId: decision.milestone.id,
  };

  const submitChanges = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const parsed = validateFeedback(feedback);
    if (!parsed.ok) {
      setLocalError(parsed.message);
      return;
    }
    setLocalError("");
    requestChanges.submit({ ...target, feedback: parsed.value }, () =>
      onDone("Changes requested. Your feedback was sent to the freelancer."),
    );
  };

  const startFunding = () => {
    const parsed = validateRequirements(requirements);
    if (!parsed.ok) {
      setLocalError(parsed.message);
      return;
    }
    setLocalError("");
    fund.submit({ ...target, requirements: parsed.value });
  };

  return (
    <div
      className="fixed inset-0 z-60 grid place-items-center bg-[#172018]/50 p-5 backdrop-blur-[3px]"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !busy) onClose();
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
            disabled={busy}
          />
          <MilestoneSummary
            title={decision.milestone.title}
            amountCents={decision.milestone.amountCents}
          />
          <label className="mt-5 block text-xs font-semibold">
            Changes requested <span className="text-[#a04d4d]">*</span>
            <textarea
              value={feedback}
              onChange={(event) => {
                setFeedback(event.target.value);
                if (localError) setLocalError("");
              }}
              rows={5}
              maxLength={5000}
              placeholder="Explain what should change, why it matters, and what you expect in the next submission…"
              aria-invalid={Boolean(localError)}
              className={`mt-2 w-full resize-none rounded-xl border p-3 text-sm font-normal outline-none ${
                localError
                  ? "border-[#c56b6b] focus:border-[#c56b6b]"
                  : "border-black/10 focus:border-[#6e916a]"
              }`}
            />
          </label>
          <ErrorLine message={localError || apiError} />
          <p className="mt-3 text-[10px] leading-5 text-[#7b8179]">
            This feedback will be sent to {contract.counterpartyName}, and the
            milestone will return to In progress.
          </p>
          <div className="mt-6 flex justify-end gap-2">
            <button
              type="button"
              onClick={onClose}
              disabled={busy}
              className="h-11 cursor-pointer rounded-xl border border-black/10 px-5 text-xs font-semibold disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={busy || !feedback.trim()}
              className="h-11 cursor-pointer rounded-xl bg-[#252724] px-5 text-xs font-semibold text-white disabled:cursor-not-allowed disabled:opacity-40"
            >
              {requestChanges.isPending ? "Sending…" : "Send revision request"}
            </button>
          </div>
        </form>
      ) : activating ? (
        <section className="w-full max-w-lg rounded-2xl bg-white p-6 shadow-2xl sm:p-7">
          <ModalHeading
            eyebrow="Secure milestone funding"
            title="Fund and activate milestone"
            onClose={onClose}
            disabled={busy}
          />
          <MilestoneSummary
            title={decision.milestone.title}
            amountCents={decision.milestone.amountCents}
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
                {formatCents(decision.milestone.amountCents)}
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
              maxLength={500}
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
              Your payment stays protected until it&apos;s released. It will not
              be released to {contract.counterpartyName} until work is submitted
              and you approve the completed milestone.
            </p>
          </div>
          <ErrorLine message={localError || apiError} />
          <div className="mt-6 flex justify-end gap-2">
            <button
              type="button"
              onClick={onClose}
              disabled={busy}
              className="h-11 cursor-pointer rounded-xl border border-black/10 px-5 text-xs font-semibold disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={startFunding}
              className="h-11 cursor-pointer rounded-xl bg-[#252724] px-5 text-xs font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50"
            >
              {busy ? "Opening checkout…" : "Fund & activate"}
            </button>
          </div>
        </section>
      ) : (
        <section className="w-full max-w-md rounded-2xl bg-white p-6 shadow-2xl sm:p-7">
          <ModalHeading
            eyebrow="Payment release"
            title="Approve this milestone?"
            onClose={onClose}
            disabled={busy}
          />
          <MilestoneSummary
            title={decision.milestone.title}
            amountCents={decision.milestone.amountCents}
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
                <strong>{formatCents(decision.milestone.amountCents)}</strong>{" "}
                to {contract.counterpartyName} and permanently mark this
                milestone as completed.
              </p>
            </div>
          </div>
          <p className="mt-4 text-xs leading-5 text-[#737970]">
            Confirm only after you have reviewed the submitted work and are
            satisfied that it meets the milestone requirements.
          </p>
          <ErrorLine message={apiError} />
          <div className="mt-6 grid gap-2 sm:grid-cols-2">
            <button
              type="button"
              onClick={onClose}
              disabled={busy}
              className="h-11 cursor-pointer rounded-xl border border-black/10 px-4 text-xs font-semibold disabled:opacity-50"
            >
              Keep reviewing
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() =>
                approve.submit(target, () =>
                  onDone("Milestone approved and payment released."),
                )
              }
              className="h-11 cursor-pointer rounded-xl bg-[#252724] px-4 text-xs font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50"
            >
              {approve.isPending ? "Releasing…" : "Yes, approve & release"}
            </button>
          </div>
        </section>
      )}
    </div>
  );
}

function ErrorLine({ message }: { message: string }) {
  if (!message) return null;
  return (
    <p role="alert" className="mt-3 text-xs text-[#a65050]">
      {message}
    </p>
  );
}

function ModalHeading({
  eyebrow,
  title,
  onClose,
  disabled = false,
}: {
  eyebrow: string;
  title: string;
  onClose: () => void;
  disabled?: boolean;
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
        disabled={disabled}
        aria-label="Close modal"
        className="cursor-pointer text-[#697067] disabled:opacity-40"
      >
        <Icon icon="solar:close-circle-linear" width="24" />
      </button>
    </div>
  );
}

function MilestoneSummary({
  title,
  amountCents,
}: {
  title: string;
  amountCents: number;
}) {
  return (
    <div className="mt-5 flex items-center justify-between gap-4 rounded-xl bg-[#f2f5f0] p-4">
      <div>
        <p className="text-[9px] text-[#7b8179]">Milestone</p>
        <p className="mt-1 text-xs font-semibold">{title}</p>
      </div>
      <strong className="text-sm">{formatCents(amountCents)}</strong>
    </div>
  );
}

function MilestoneProgress({ contract }: { contract: ContractItem }) {
  const totals = contractTotals(contract);
  const paidCount = contract.milestones.filter(
    (milestone) => milestoneState(milestone) === "PAID",
  ).length;

  return (
    <section className="mt-7 rounded-2xl border border-black/7 bg-[#f7f9f5] p-4 sm:p-5">
      <div className="flex items-end justify-between gap-4">
        <div>
          <p className="text-xs font-semibold">Contract completion</p>
          <p className="mt-1 text-[10px] text-[#7b8179]">
            {paidCount} of {contract.milestones.length} milestones completed
          </p>
        </div>
        <strong className="text-xl text-[#52784f]">
          {totals.progressPercent}%
        </strong>
      </div>
      <div className="mt-4 flex h-2 gap-1 overflow-hidden rounded-full bg-[#e4e8e1]">
        {contract.milestones.map((milestone) => (
          <span
            key={milestone.id}
            title={`${milestone.title}: ${milestoneLabel(milestone)}`}
            className={`h-full transition-colors ${milestoneTone(milestoneState(milestone)).bar}`}
            style={{
              width: `${totals.totalCents > 0 ? (milestone.amountCents / totals.totalCents) * 100 : 0}%`,
            }}
          />
        ))}
      </div>
      <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
        {contract.milestones.map((milestone, index) => {
          const tone = milestoneTone(milestoneState(milestone));
          return (
            <div key={milestone.id} className="min-w-0">
              <div className="flex items-center gap-1.5">
                <span className={`h-2 w-2 shrink-0 rounded-full ${tone.dot}`} />
                <span className="truncate text-[9px] font-semibold">
                  {index + 1}. {milestone.title}
                </span>
              </div>
              <p className={`mt-1 pl-3.5 text-[9px] ${tone.text}`}>
                {milestoneLabel(milestone)}
              </p>
            </div>
          );
        })}
      </div>
    </section>
  );
}

function milestoneTone(state: MilestoneState) {
  switch (state) {
    case "PAID":
      return {
        bar: "bg-[#5e8b5a]",
        dot: "bg-[#5e8b5a]",
        text: "text-[#52784f]",
        marker: "bg-[#e3f0df] text-[#52784f]",
        badge: "bg-[#e3f0df] text-[#52784f]",
        card: "border-[#cadcc6] bg-[#fbfdf9]",
      };
    case "SUBMITTED":
      return {
        bar: "bg-[#c1a34d]",
        dot: "bg-[#c1a34d]",
        text: "text-[#826d2f]",
        marker: "bg-[#f5eed4] text-[#806d31]",
        badge: "bg-[#f5eed4] text-[#806d31]",
        card: "border-[#e2d7ad] bg-[#fffdf7]",
      };
    case "IN_PROGRESS":
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
