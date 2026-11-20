"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { AdminIcon } from "../../_components/admin-icon";
import { Badge, EmptyState, TableShell } from "../../_components/ui";
import {
  formatCurrency,
  formatDate,
  initialsFor,
} from "../../_components/format";

export interface AdminProposal {
  id: string;
  jobId: string;
  jobTitle: string;
  jobBudget: number;
  jobStatus: string;
  senderId: string;
  senderType: "FREELANCER" | "AGENCY";
  senderName: string;
  senderAvatarUrl: string | null;
  senderEmail: string | null;
  agencySpecialty: string | null;
  agencyWebsite: string | null;
  coverLetter: string;
  bidAmount: number;
  duration: string;
  screeningAnswers: Array<{ question: string; answer: string }>;
  status: string;
  isShortlisted: boolean;
  createdAt: string;
  updatedAt: string | null;
}

const STATUS_TONE: Record<string, "green" | "amber" | "blue" | "gray"> = {
  SUBMITTED: "gray",
  VIEWED: "blue",
  INTERVIEWED: "amber",
  HIRED: "green",
};

export function ProposalsTable({
  proposals,
  footer,
}: {
  proposals: AdminProposal[];
  footer?: React.ReactNode;
}) {
  const [selected, setSelected] = useState<AdminProposal | null>(null);

  useEffect(() => {
    if (!selected) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setSelected(null);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [selected]);

  return (
    <>
      <TableShell
        title="Proposal explorer"
        description="Freelancer and agency proposals across all jobs — click a row to review"
        count={proposals.length}
        footer={footer}
      >
        <table className="w-full min-w-200 border-collapse text-left">
          <thead className="bg-[#fafbf9] text-[10px] font-semibold tracking-[.08em] text-[#7c8179] uppercase">
            <tr>
              <th className="px-5 py-3">Sender</th>
              <th className="px-5 py-3">Job</th>
              <th className="px-5 py-3">Bid</th>
              <th className="px-5 py-3">Status</th>
              <th className="px-5 py-3">Submitted</th>
            </tr>
          </thead>
          <tbody>
            {proposals.map((proposal) => (
              <tr
                key={proposal.id}
                onClick={() => setSelected(proposal)}
                className="cursor-pointer border-t border-black/6 text-xs hover:bg-[#fafbf9]"
              >
                <td className="px-5 py-4">
                  <strong>{proposal.senderName}</strong>
                  <p className="mt-0.5 text-[10px] text-[#858a82]">
                    {proposal.senderType === "AGENCY" ? "Agency" : "Freelancer"}
                    {proposal.isShortlisted && " · Shortlisted"}
                  </p>
                </td>
                <td className="max-w-72 px-5 py-4 text-[#71766e]">
                  <span className="line-clamp-1">{proposal.jobTitle}</span>
                </td>
                <td className="px-5 py-4 font-semibold">
                  {formatCurrency(proposal.bidAmount)}
                </td>
                <td className="px-5 py-4">
                  <Badge
                    label={proposal.status}
                    tone={STATUS_TONE[proposal.status] ?? "gray"}
                  />
                </td>
                <td className="px-5 py-4 text-[#858a82]">
                  {formatDate(proposal.createdAt)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {!proposals.length && <EmptyState label="No proposals yet." />}
      </TableShell>

      {selected && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-5"
          onClick={() => setSelected(null)}
        >
          <div
            onClick={(event) => event.stopPropagation()}
            className="flex max-h-[85vh] w-full max-w-2xl flex-col overflow-hidden rounded-2xl bg-white shadow-2xl"
          >
            <header className="flex items-start justify-between gap-3 border-b border-black/7 p-5">
              <div className="flex min-w-0 items-center gap-3">
                {selected.senderAvatarUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={selected.senderAvatarUrl}
                    alt=""
                    className="h-11 w-11 shrink-0 rounded-full object-cover"
                  />
                ) : (
                  <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-[#527a73] text-xs font-semibold text-white">
                    {initialsFor(selected.senderName)}
                  </span>
                )}
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <h2 className="truncate text-sm font-semibold">
                      {selected.senderName}
                    </h2>
                    <Badge
                      label={selected.status}
                      tone={STATUS_TONE[selected.status] ?? "gray"}
                    />
                    {selected.isShortlisted && (
                      <Badge label="Shortlisted" tone="green" />
                    )}
                  </div>
                  <p className="mt-0.5 truncate text-[10px] text-[#858a82]">
                    {selected.senderType === "AGENCY" ? "Agency" : "Freelancer"}
                    {selected.senderEmail && ` · ${selected.senderEmail}`}
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setSelected(null)}
                aria-label="Close"
                className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full hover:bg-black/4"
              >
                <AdminIcon name="close" size={16} />
              </button>
            </header>

            <div className="overflow-y-auto p-5">
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                <Stat label="Bid" value={formatCurrency(selected.bidAmount)} />
                <Stat label="Duration" value={selected.duration} />
                <Stat
                  label="Job budget"
                  value={formatCurrency(selected.jobBudget)}
                />
                <Stat
                  label="Submitted"
                  value={formatDate(selected.createdAt)}
                />
              </div>

              <Section title="Applying to">
                <Link
                  href="/job-posts"
                  className="text-xs font-semibold text-[#52784f] hover:underline"
                >
                  {selected.jobTitle}
                </Link>
              </Section>

              <Section title="Cover letter">
                <p className="whitespace-pre-wrap text-xs leading-6 text-[#4a4e47]">
                  {selected.coverLetter}
                </p>
              </Section>

              {selected.screeningAnswers.length > 0 && (
                <Section title="Screening answers">
                  <div className="space-y-3">
                    {selected.screeningAnswers.map((qa) => (
                      <div key={qa.question}>
                        <p className="text-xs font-semibold">{qa.question}</p>
                        <p className="mt-1 text-xs leading-6 text-[#71766e]">
                          {qa.answer}
                        </p>
                      </div>
                    ))}
                  </div>
                </Section>
              )}

              {selected.senderType === "AGENCY" && (
                <Section title="Agency">
                  <div className="rounded-xl bg-[#f4f6f2] p-3 text-xs leading-6">
                    <p className="font-semibold">{selected.senderName}</p>
                    {selected.agencySpecialty && (
                      <p className="text-[#71766e]">
                        {selected.agencySpecialty}
                      </p>
                    )}
                    {selected.agencyWebsite && (
                      <a
                        href={selected.agencyWebsite}
                        target="_blank"
                        rel="noreferrer"
                        className="text-[#52784f] hover:underline"
                      >
                        {selected.agencyWebsite}
                      </a>
                    )}
                  </div>
                </Section>
              )}

              <p className="mt-5 text-[10px] text-[#969b94]">
                Proposal ID: {selected.id} · Sender ID: {selected.senderId}
              </p>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl bg-[#f3f5f1] p-3">
      <p className="text-sm font-semibold tracking-[-.02em]">{value}</p>
      <p className="mt-1 text-[9px] text-[#7c8179]">{label}</p>
    </div>
  );
}

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="mt-5">
      <h3 className="text-[10px] font-semibold tracking-[.1em] text-[#7c8179] uppercase">
        {title}
      </h3>
      <div className="mt-2">{children}</div>
    </div>
  );
}
