"use client";

import { useAuth } from "@clerk/nextjs";
import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { agencyProposalMetadataQueryKey } from "@/hooks/use-agency-proposal-metadata";
import { Icon } from "../ui/icon";
import type { AgencyJob } from "./types";

type AgencySummary = {
  name: string;
  avatarImage: { imageId: string; url: string } | null;
  members: unknown[];
};

const getInitials = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((word) => word[0]?.toUpperCase())
    .join("") || "?";

export function AgencyProposalModal({
  job,
  agency,
  onClose,
}: {
  job: AgencyJob;
  agency: AgencySummary | null;
  onClose: () => void;
}) {
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const { getToken } = useAuth();
  const queryClient = useQueryClient();

  const submitProposal = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSubmitting(true);
    setError("");
    const form = new FormData(event.currentTarget);
    const token = await getToken();

    const response = await fetch(
      `${process.env.NEXT_PUBLIC_SERVER_URI}/agency/proposals?role=freelancer`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          jobId: job.id,
          bidAmount: form.get("bidAmount"),
          duration: form.get("duration"),
          coverLetter: form.get("coverLetter"),
          screeningAnswers: job.screeningQuestions.map((_, index) =>
            form.get(`screening-${index}`),
          ),
        }),
      },
    );
    const result = await response.json();
    setSubmitting(false);
    if (!response.ok) {
      setError(result.message || "Proposal could not be submitted.");
      return;
    }
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: agencyProposalMetadataQueryKey }),
      queryClient.invalidateQueries({ queryKey: ["agency-connects"] }),
      queryClient.invalidateQueries({ queryKey: ["agency-proposals"] }),
    ]);
    setSubmitted(true);
  };

  const memberCount = agency?.members.length ?? 0;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="agency-proposal-title"
      className="fixed inset-0 z-60 flex items-center justify-center bg-[#182019]/55 p-4 backdrop-blur-[2px]"
    >
      <div className="max-h-[calc(100svh-2rem)] w-full max-w-xl overflow-y-auto rounded-3xl bg-white shadow-2xl">
        {submitted ? (
          <div className="px-7 py-12 text-center sm:px-10">
            <span className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-[#e8f3e5] text-[#4f7b4c]">
              <Icon name="verified" size={34} />
            </span>
            <h2 className="mt-6 text-2xl font-semibold tracking-[-0.035em]">
              Agency proposal submitted
            </h2>
            <p className="mx-auto mt-3 max-w-sm text-sm leading-6 text-[#686e66]">
              {agency?.name ?? "Your agency"}’s proposal for “{job.title}” is
              ready for {job.company} to review.
            </p>
            <button
              type="button"
              onClick={onClose}
              className="mt-7 cursor-pointer rounded-xl bg-[#252724] px-6 py-3 text-sm font-semibold text-white"
            >
              Back to jobs
            </button>
          </div>
        ) : (
          <>
            <div className="flex items-start justify-between border-b border-black/8 px-6 py-5 sm:px-8">
              <div>
                <p className="text-xs font-semibold tracking-[0.12em] text-[#5c8159] uppercase">
                  Submit as {agency?.name ?? "your agency"}
                </p>
                <h2
                  id="agency-proposal-title"
                  className="mt-2 max-w-md text-xl font-semibold tracking-tight"
                >
                  {job.title}
                </h2>
                <p className="mt-1 text-sm text-[#777c74]">
                  {job.company} · Fixed price {job.budget}
                </p>
              </div>
              <button
                type="button"
                onClick={onClose}
                aria-label="Close proposal"
                className="flex h-9 w-9 shrink-0 cursor-pointer items-center justify-center rounded-full hover:bg-black/5"
              >
                <Icon name="close" size={23} />
              </button>
            </div>
            <form
              onSubmit={submitProposal}
              className="grid gap-5 px-6 py-6 sm:px-8"
            >
              <div className="flex items-center gap-3 rounded-xl bg-[#f2f5f0] p-4">
                {agency?.avatarImage ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={agency.avatarImage.url}
                    alt=""
                    className="h-10 w-10 shrink-0 rounded-xl object-cover"
                  />
                ) : (
                  <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[#496e67] text-xs font-semibold text-white">
                    {getInitials(agency?.name ?? "?")}
                  </span>
                )}
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold">
                    {agency?.name ?? "Your agency"}
                  </p>
                  <p className="mt-0.5 text-[11px] text-[#7b8078]">
                    Agency profile · {memberCount} member
                    {memberCount === 1 ? "" : "s"}
                  </p>
                </div>
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                <label className="grid gap-2 text-sm font-semibold">
                  Agency bid
                  <span className="relative">
                    <span className="absolute inset-y-0 left-3.5 flex items-center text-[#777c74]">
                      $
                    </span>
                    <input
                      required
                      name="bidAmount"
                      type="number"
                      min="1"
                      defaultValue={job.budgetValue}
                      className="h-12 w-full rounded-xl border border-black/11 bg-white pr-14 pl-8 font-normal outline-none focus:border-[#70966d]"
                    />
                    <span className="absolute inset-y-0 right-3.5 flex items-center text-xs text-[#858a82]">
                      USD
                    </span>
                  </span>
                </label>
                <label className="grid gap-2 text-sm font-semibold">
                  Delivery timeline
                  <select
                    name="duration"
                    required
                    defaultValue={job.duration}
                    className="h-12 rounded-xl border border-black/11 bg-white px-3.5 font-normal outline-none focus:border-[#70966d]"
                  >
                    <option>Less than 1 month</option>
                    <option>1–2 months</option>
                    <option>3–6 months</option>
                    <option>More than 6 months</option>
                  </select>
                </label>
              </div>

              <label className="grid gap-2 text-sm font-semibold">
                <span className="flex items-center">
                  Cover letter <span className="pl-1 text-red-500">*</span>
                </span>
                <textarea
                  name="coverLetter"
                  required
                  minLength={80}
                  rows={6}
                  placeholder="Explain your agency’s relevant experience, approach, and why the team is a strong fit…"
                  className="resize-none rounded-xl border border-black/11 bg-white p-3.5 font-normal leading-6 outline-none placeholder:text-[#a1a59e] focus:border-[#70966d]"
                />
                <span className="text-right text-[11px] font-normal text-[#8a8e87]">
                  Minimum 80 characters
                </span>
              </label>

              {!!job.screeningQuestions?.length && (
                <div className="grid gap-4 border-t border-black/7 pt-5">
                  <h3 className="font-semibold">Additional Questions</h3>
                  {job.screeningQuestions.map((question, index) => (
                    <label
                      key={question}
                      className="grid gap-2 text-sm font-semibold"
                    >
                      <span className="flex items-center">
                        {question} <span className="pl-1 text-red-500">*</span>
                      </span>
                      <textarea
                        name={`screening-${index}`}
                        required
                        rows={3}
                        className="resize-none rounded-xl border border-black/11 bg-white p-3.5 font-normal leading-6 outline-none focus:border-[#70966d]"
                      />
                    </label>
                  ))}
                </div>
              )}

              <div className="rounded-xl bg-[#eff4ed] p-4 text-xs leading-5 text-[#626960]">
                <strong className="text-[#333832]">
                  Your agency will use 6 Connects.
                </strong>
              </div>
              {error && <p className="text-sm text-red-600">{error}</p>}
              <div className="flex justify-end gap-3 border-t border-black/7 pt-5">
                <button
                  type="button"
                  onClick={onClose}
                  className="cursor-pointer rounded-xl border border-black/10 px-5 py-2.5 text-sm font-semibold"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={submitting}
                  className="cursor-pointer rounded-xl bg-[#252724] px-5 py-2.5 text-sm font-semibold text-white disabled:opacity-50"
                >
                  {submitting ? "Submitting..." : "Submit agency proposal"}
                </button>
              </div>
            </form>
          </>
        )}
      </div>
    </div>
  );
}
