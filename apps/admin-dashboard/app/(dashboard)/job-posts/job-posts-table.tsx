"use client";

import { useEffect, useState } from "react";
import { AdminIcon } from "../../_components/admin-icon";
import { Badge, EmptyState, TableShell } from "../../_components/ui";
import {
  formatDate,
  formatDateTime,
  type Components,
} from "@onemarketplace/api-client";
import { jobPostMoneyView } from "../../../lib/money-views";
import { JOB_STATUS_TONE } from "../../../lib/labels";

export type AdminJobPost = Components["schemas"]["AdminJobPostItem"];

export function JobPostsTable({
  jobs,
  footer,
}: {
  jobs: AdminJobPost[];
  footer?: React.ReactNode;
}) {
  const [selected, setSelected] = useState<AdminJobPost | null>(null);
  const selectedMoney = selected ? jobPostMoneyView(selected) : null;

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
        title="Job post explorer"
        description="Client-posted jobs across the marketplace — click a row to review"
        count={jobs.length}
        footer={footer}
      >
        <table className="w-full min-w-200 border-collapse text-left">
          <thead className="bg-[#fafbf9] text-[10px] font-semibold tracking-[.08em] text-[#7c8179] uppercase">
            <tr>
              <th className="px-5 py-3">Job</th>
              <th className="px-5 py-3">Client</th>
              <th className="px-5 py-3">Budget</th>
              <th className="px-5 py-3">Status</th>
              <th className="px-5 py-3">Proposals</th>
              <th className="px-5 py-3">Hires</th>
              <th className="px-5 py-3">Posted</th>
            </tr>
          </thead>
          <tbody>
            {jobs.map((job) => (
              <tr
                key={job.id}
                onClick={() => setSelected(job)}
                className="cursor-pointer border-t border-black/6 text-xs hover:bg-[#fafbf9]"
              >
                <td className="max-w-80 px-5 py-4">
                  <strong className="line-clamp-1">{job.title}</strong>
                  <p className="mt-0.5 text-[10px] text-[#858a82]">
                    {job.expertiseLevel}
                  </p>
                </td>
                <td className="px-5 py-4 text-[#71766e]">{job.clientName}</td>
                <td className="px-5 py-4 font-semibold">
                  {jobPostMoneyView(job).totalBudget}
                </td>
                <td className="px-5 py-4">
                  <Badge
                    label={job.status}
                    tone={JOB_STATUS_TONE[job.status]}
                  />
                </td>
                <td className="px-5 py-4 text-[#71766e]">
                  {job.proposalCount}
                </td>
                <td className="px-5 py-4 text-[#71766e]">{job.hireCount}</td>
                <td className="px-5 py-4 text-[#858a82]">
                  {formatDateTime(job.createdAt)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {!jobs.length && <EmptyState label="No job posts yet." />}
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
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge
                    label={selected.status}
                    tone={JOB_STATUS_TONE[selected.status]}
                  />
                  <span className="text-[10px] text-[#858a82]">
                    {selected.expertiseLevel} · {selected.expectedDuration}
                  </span>
                </div>
                <h2 className="mt-2 text-lg font-semibold">{selected.title}</h2>
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
                <Stat
                  label="Budget"
                  value={selectedMoney?.totalBudget ?? "—"}
                />
                <Stat
                  label="Proposals"
                  value={String(selected.proposalCount)}
                />
                <Stat label="Hires" value={String(selected.hireCount)} />
                <Stat
                  label="Posted"
                  value={formatDateTime(selected.createdAt)}
                />
              </div>

              <Section title="Description">
                <p className="whitespace-pre-wrap text-xs leading-6 text-[#4a4e47]">
                  {selected.description}
                </p>
              </Section>

              {selected.skills.length > 0 && (
                <Section title="Skills">
                  <div className="flex flex-wrap gap-1.5">
                    {selected.skills.map((skill) => (
                      <span
                        key={skill}
                        className="rounded-lg bg-[#f1f3ef] px-2.5 py-1.5 text-[10px] font-medium text-[#596057]"
                      >
                        {skill}
                      </span>
                    ))}
                  </div>
                </Section>
              )}

              {selected.milestones.length > 0 && (
                <Section title="Milestones">
                  <div className="space-y-2">
                    {selected.milestones.map((milestone) => (
                      <div
                        key={milestone.id}
                        className="flex items-center justify-between gap-3 rounded-xl bg-[#f4f6f2] px-3 py-2.5 text-xs"
                      >
                        <span className="min-w-0 truncate">
                          {milestone.title}
                        </span>
                        <span className="shrink-0 text-[#858a82]">
                          {selectedMoney?.milestones.find(
                            (item) => item.id === milestone.id,
                          )?.budget ?? "—"}{" "}
                          · due {formatDate(milestone.dueDate)}
                        </span>
                      </div>
                    ))}
                  </div>
                </Section>
              )}

              {(selected.screeningQuestions?.length ?? 0) > 0 && (
                <Section title="Screening questions">
                  <ol className="list-decimal space-y-1.5 pl-4 text-xs text-[#4a4e47]">
                    {selected.screeningQuestions?.map((question) => (
                      <li key={question}>{question}</li>
                    ))}
                  </ol>
                </Section>
              )}

              {(selected.attachments?.length ?? 0) > 0 && (
                <Section title="Attachments">
                  <div className="space-y-1.5">
                    {selected.attachments?.map((attachment) => (
                      <a
                        key={attachment.fileId || attachment.fileUrl}
                        href={attachment.fileUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="flex items-center justify-between gap-3 rounded-xl border border-black/8 px-3 py-2 text-xs hover:bg-[#fafbf9]"
                      >
                        <span className="min-w-0 truncate">
                          {attachment.fileName}
                        </span>
                        <span className="shrink-0 text-[10px] text-[#969b94]">
                          {Math.round(attachment.fileSize / 1024)} KB
                        </span>
                      </a>
                    ))}
                  </div>
                </Section>
              )}

              <Section title="Client">
                <div className="rounded-xl bg-[#f4f6f2] p-3 text-xs leading-6">
                  <p className="font-semibold">
                    {selected.companyName ?? selected.clientName}
                  </p>
                  {selected.clientEmail && <p>{selected.clientEmail}</p>}
                  {selected.industry && (
                    <p className="text-[#71766e]">{selected.industry}</p>
                  )}
                  {selected.companyWebsite && (
                    <a
                      href={selected.companyWebsite}
                      target="_blank"
                      rel="noreferrer"
                      className="text-[#52784f] hover:underline"
                    >
                      {selected.companyWebsite}
                    </a>
                  )}
                  {selected.companyDescription && (
                    <p className="mt-2 text-[#71766e]">
                      {selected.companyDescription}
                    </p>
                  )}
                </div>
              </Section>

              <p className="mt-5 text-[10px] text-[#969b94]">
                Job ID: {selected.id} · Client ID: {selected.clientId}
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
