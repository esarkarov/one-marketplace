"use client";

import { Icon } from "@iconify/react";
import Image from "next/image";
import type { Contract } from "./types";

type ContractCardProps = {
  contract: Contract;
  onView: (contract: Contract) => void;
  onSubmit: (contract: Contract) => void;
  onAccept: (contract: Contract) => void;
  onReject: (contract: Contract) => void;
  onFinish: (contract: Contract) => void;
};

export function ContractCard({
  contract,
  onView,
  onSubmit,
  onAccept,
  onReject,
  onFinish,
}: ContractCardProps) {
  const awaiting = contract.status === "Awaiting feedback";
  const pending = contract.status === "Pending";
  const allMilestonesCompleted =
    contract.milestones.length > 0 &&
    contract.milestones.every((milestone) => milestone.status === "Paid");

  return (
    <article className="rounded-2xl border border-black/8 bg-white p-5 sm:p-6">
      <div className="flex flex-col justify-between gap-5 lg:flex-row">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className={`rounded-full px-2.5 py-1 text-[11px] font-semibold ${pending || awaiting ? "bg-[#f2efe3] text-[#796f42]" : "bg-[#e6f2e3] text-[#477344]"}`}>
              {contract.status}
            </span>
            <span className="text-xs text-[#858a82]">Started {contract.started}</span>
          </div>
          <h2 className="mt-3 text-xl font-semibold tracking-[-0.025em]">{contract.title}</h2>
          <div className="mt-2 flex items-center gap-2 text-sm text-[#747a72]">
            <span className="relative flex h-7 w-7 shrink-0 items-center justify-center overflow-hidden rounded-full bg-[#e9efea] text-[10px] font-semibold text-[#4e716b]">
              {contract.clientAvatar ? (
                <Image
                  src={contract.clientAvatar}
                  alt={contract.client}
                  fill
                  sizes="28px"
                  className="object-cover"
                />
              ) : (
                contract.clientInitials
              )}
            </span>
            <strong className="text-[#343833]">{contract.client}</strong>
            {contract.clientLocation && (
              <>
                <span>·</span>
                <span>{contract.clientLocation}</span>
              </>
            )}
          </div>
        </div>
        <div className="grid grid-cols-3 gap-5 lg:min-w-72">
          {[["Contract", contract.totalBudget], ["Earned", contract.earned], ["In escrow", contract.funded]].map(([label, value]) => (
            <div key={label}>
              <p className="text-[11px] text-[#858a82]">{label}</p>
              <p className="mt-1 text-sm font-semibold">{value}</p>
            </div>
          ))}
        </div>
      </div>

      <div className="mt-6 rounded-xl bg-[#f4f6f2] p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-[11px] font-semibold tracking-wide text-[#6e756c] uppercase">Current milestone</p>
            <p className="mt-1.5 text-sm font-semibold">{contract.currentMilestone}</p>
          </div>
          <div className="text-left sm:text-right">
            <p className="text-[11px] text-[#858a82]">Next deadline</p>
            <p className="mt-1 text-sm font-semibold">{contract.nextDeadline}</p>
          </div>
        </div>
        <div className="mt-4 flex items-center gap-3">
          <div className="h-2 flex-1 overflow-hidden rounded-full bg-[#dfe5dc]">
            <div className="h-full rounded-full bg-[#638b60]" style={{ width: `${contract.progress}%` }} />
          </div>
          <span className="text-xs font-semibold text-[#52784f]">{contract.progress}%</span>
        </div>
      </div>

      <div className="mt-5 flex flex-wrap items-center justify-between gap-3">
        <p className="inline-flex items-center gap-2 text-xs text-[#737870]">
          <Icon icon={awaiting ? "solar:clock-circle-linear" : "solar:shield-check-linear"} width="17" />
          {pending
            ? "Review and accept the funded contract offer"
            : awaiting
              ? "Work submitted — awaiting client review"
              : `${contract.funded} funded for this milestone`}
        </p>
        <div className="flex gap-2">
          <button type="button" onClick={() => onView(contract)} className="cursor-pointer rounded-xl border border-black/10 px-4 py-2.5 text-xs font-semibold hover:bg-black/3">
            View contract
          </button>
          {pending ? (
            <>
              <button type="button" onClick={() => onReject(contract)} className="cursor-pointer rounded-xl border border-black/10 px-4 py-2.5 text-xs font-semibold">
                Reject
              </button>
              <button type="button" onClick={() => onAccept(contract)} className="cursor-pointer rounded-xl bg-[#252724] px-4 py-2.5 text-xs font-semibold text-white hover:bg-[#3b3e39]">
                Accept contract
              </button>
            </>
          ) : !awaiting &&
            contract.status !== "Completed" &&
            contract.currentMilestoneId ? (
            <button type="button" onClick={() => onSubmit(contract)} className="cursor-pointer rounded-xl bg-[#252724] px-4 py-2.5 text-xs font-semibold text-white hover:bg-[#3b3e39]">
              Submit work
            </button>
          ) : contract.status === "Active" && allMilestonesCompleted ? (
            <button type="button" onClick={() => onFinish(contract)} className="cursor-pointer rounded-xl bg-[#252724] px-4 py-2.5 text-xs font-semibold text-white">
              Finish contract
            </button>
          ) : contract.status === "Completed" && !contract.reviewedByCurrentUser ? (
            <button type="button" onClick={() => onFinish(contract)} className="cursor-pointer rounded-xl bg-[#252724] px-4 py-2.5 text-xs font-semibold text-white">
              Give review
            </button>
          ) : null}
        </div>
      </div>
    </article>
  );
}
