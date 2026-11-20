"use client";

import Link from "next/link";
import { Icon } from "../ui/icon";
import { contractStatusStyles } from "./contracts-data";
import type { AgencyContract, AgencyMilestoneStatus } from "./types";

const milestoneStyles: Record<AgencyMilestoneStatus, string> = {
  Paid: "bg-[#e6f2e3] text-[#477344]",
  "In progress": "bg-[#e8eff4] text-[#496c86]",
  Upcoming: "bg-[#f0f1ee] text-[#747971]",
};

type ContractDrawerProps = {
  contract: AgencyContract;
  onClose: () => void;
  onSubmit: () => void;
  onAccept: () => void;
  onReject: () => void;
  onFinish: () => void;
};

export function ContractDrawer({
  contract,
  onClose,
  onSubmit,
  onAccept,
  onReject,
  onFinish,
}: ContractDrawerProps) {
  const pending = contract.status === "Pending";
  const awaiting = contract.status === "Awaiting feedback";
  const allMilestonesCompleted =
    contract.milestones.length > 0 &&
    contract.milestones.every((milestone) => milestone.status === "Paid");

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="contract-title"
      className="fixed inset-0 z-50 flex justify-end bg-[#172018]/45 backdrop-blur-[2px]"
    >
      <div className="h-full w-full max-w-2xl overflow-y-auto bg-white shadow-2xl">
        <header className="sticky top-0 z-10 flex items-start justify-between border-b border-black/8 bg-white px-6 py-5 sm:px-8">
          <div>
            <p className="text-xs font-semibold tracking-wide text-[#62805f] uppercase">
              Agency contract
            </p>
            <h2 id="contract-title" className="mt-2 text-xl font-semibold">
              {contract.title}
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close contract"
            className="cursor-pointer"
          >
            <Icon name="close" size={25} />
          </button>
        </header>

        <div className="grid gap-7 p-6 sm:p-8">
          <section className="flex flex-col justify-between gap-4 rounded-2xl bg-[#f1f5ef] p-5 sm:flex-row sm:items-center">
            <div>
              <p className="text-xs text-[#777d75]">Client</p>
              <p className="mt-1 font-semibold">{contract.client}</p>
              {contract.clientLocation && (
                <p className="mt-1 text-xs text-[#777d75]">
                  {contract.clientLocation}
                </p>
              )}
            </div>
            {contract.conversationId ? (
              <Link
                href={`/messages?conversationId=${contract.conversationId}`}
                className="inline-flex h-10 items-center justify-center gap-2 rounded-xl border border-black/9 bg-white px-4 text-xs font-semibold"
              >
                <Icon name="message" size={17} />
                Message client
              </Link>
            ) : (
              <button
                type="button"
                disabled
                className="inline-flex h-10 cursor-not-allowed items-center justify-center gap-2 rounded-xl border border-black/9 bg-white px-4 text-xs font-semibold opacity-45"
              >
                <Icon name="message" size={17} />
                Message client
              </button>
            )}
          </section>

          <section>
            <h3 className="text-sm font-semibold">Contract overview</h3>
            <p className="mt-3 text-sm leading-7 text-[#686e66]">
              {contract.description}
            </p>
            <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
              {[
                ["Total", contract.totalBudget],
                ["Earned", contract.earned],
                ["In escrow", contract.escrow],
                ["Started", contract.started],
              ].map(([label, value]) => (
                <div key={label} className="rounded-xl border border-black/7 p-3">
                  <p className="text-[10px] text-[#858a82]">{label}</p>
                  <p className="mt-1.5 text-sm font-semibold">{value}</p>
                </div>
              ))}
            </div>
          </section>

          <section>
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold">Milestones</h3>
              <span className="text-xs text-[#7b8078]">
                {
                  contract.milestones.filter(
                    (milestone) => milestone.status === "Paid",
                  ).length
                }{" "}
                of {contract.milestones.length} paid
              </span>
            </div>
            <div className="mt-3 overflow-hidden rounded-2xl border border-black/8">
              {contract.milestones.map((milestone, index) => (
                <div
                  key={milestone.id}
                  className={`flex items-center gap-4 p-4 ${index ? "border-t border-black/7" : ""}`}
                >
                  <span
                    className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full ${
                      milestone.status === "Paid"
                        ? "bg-[#e4f0e1] text-[#4d784a]"
                        : "bg-[#f0f2ee] text-[#7b8078]"
                    }`}
                  >
                    <Icon
                      name={milestone.status === "Paid" ? "check-circle" : "clock"}
                      size={18}
                    />
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold">
                      {milestone.title}
                    </p>
                    <p className="mt-1 text-[11px] text-[#858a82]">
                      Due {milestone.due}
                    </p>
                  </div>
                  <div className="text-right">
                    <p className="text-sm font-semibold">{milestone.amount}</p>
                    <span
                      className={`mt-1 inline-block rounded-full px-2 py-0.5 text-[10px] font-semibold ${milestoneStyles[milestone.status]}`}
                    >
                      {milestone.status}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </section>

          <section className="rounded-2xl bg-[#252724] p-5 text-white">
            <p className="text-xs text-white/60">Current milestone</p>
            <p className="mt-2 font-semibold">{contract.currentMilestone}</p>
            <div className="mt-4 h-1.5 overflow-hidden rounded-full bg-white/15">
              <div
                className="h-full rounded-full bg-[#9fbd98]"
                style={{ width: `${contract.progress}%` }}
              />
            </div>
            <div className="mt-4 flex items-center justify-between">
              <span className="text-xs text-white/65">
                {contract.progress}% complete
              </span>
              {pending ? (
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={onReject}
                    className="cursor-pointer rounded-lg border border-white/25 px-3.5 py-2 text-xs font-semibold"
                  >
                    Reject
                  </button>
                  <button
                    type="button"
                    onClick={onAccept}
                    className="cursor-pointer rounded-lg bg-white px-3.5 py-2 text-xs font-semibold text-[#252724]"
                  >
                    Accept contract
                  </button>
                </div>
              ) : !awaiting &&
                contract.status !== "Completed" &&
                contract.currentMilestoneId ? (
                <button
                  type="button"
                  onClick={onSubmit}
                  className="cursor-pointer rounded-lg bg-white px-3.5 py-2 text-xs font-semibold text-[#252724]"
                >
                  Submit work
                </button>
              ) : contract.status === "Active" && allMilestonesCompleted ? (
                <button
                  type="button"
                  onClick={onFinish}
                  className="cursor-pointer rounded-lg bg-white px-3.5 py-2 text-xs font-semibold text-[#252724]"
                >
                  Finish contract
                </button>
              ) : contract.status === "Completed" &&
                !contract.reviewedByCurrentUser ? (
                <button
                  type="button"
                  onClick={onFinish}
                  className="cursor-pointer rounded-lg bg-white px-3.5 py-2 text-xs font-semibold text-[#252724]"
                >
                  Give review
                </button>
              ) : null}
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
