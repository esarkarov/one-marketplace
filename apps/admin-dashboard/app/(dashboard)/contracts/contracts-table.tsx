"use client";

import { useEffect, useState } from "react";
import { AdminIcon } from "../../_components/admin-icon";
import { Badge, EmptyState, TableShell } from "../../_components/ui";
import {
  formatDate,
  formatDateTime,
  type Components,
} from "@onemarketplace/api-client";
import { initialsFor } from "../../_components/format";
import { contractMoneyView } from "../../../lib/money-views";
import {
  CONTRACT_STATUS,
  TALENT_KIND_LABEL,
  type Tone,
} from "../../../lib/labels";

export type AdminContract = Components["schemas"]["AdminContractItem"];

const MILESTONE_TONE: Record<string, Tone> = {
  PENDING: "amber",
  ACTIVE: "blue",
  COMPLETED: "green",
};

export function ContractsTable({
  contracts,
  footer,
}: {
  contracts: AdminContract[];
  footer?: React.ReactNode;
}) {
  const [selected, setSelected] = useState<AdminContract | null>(null);
  const selectedMoney = selected ? contractMoneyView(selected) : null;

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
        title="Contract explorer"
        description="Pending, active, completed and cancelled engagements — click a row to review"
        count={contracts.length}
        footer={footer}
      >
        <table className="w-full min-w-200 border-collapse text-left">
          <thead className="bg-[#fafbf9] text-[10px] font-semibold tracking-[.08em] text-[#7c8179] uppercase">
            <tr>
              <th className="px-5 py-3">Contract</th>
              <th className="px-5 py-3">Client</th>
              <th className="px-5 py-3">Talent</th>
              <th className="px-5 py-3">Kind</th>
              <th className="px-5 py-3">Value</th>
              <th className="px-5 py-3">Status</th>
              <th className="px-5 py-3">Created</th>
            </tr>
          </thead>
          <tbody>
            {contracts.map((contract) => (
              <tr
                key={contract.id}
                onClick={() => setSelected(contract)}
                className="cursor-pointer border-t border-black/6 text-xs hover:bg-[#fafbf9]"
              >
                <td className="max-w-72 px-5 py-4">
                  <strong className="line-clamp-1">{contract.title}</strong>
                </td>
                <td className="px-5 py-4 text-[#71766e]">
                  {contract.clientName}
                </td>
                <td className="px-5 py-4 text-[#71766e]">
                  {contract.talentName}
                </td>
                <td className="px-5 py-4">
                  <Badge
                    label={TALENT_KIND_LABEL[contract.talentKind]}
                    tone="gray"
                  />
                </td>
                <td className="px-5 py-4 font-semibold">
                  {contractMoneyView(contract).total}
                </td>
                <td className="px-5 py-4">
                  <Badge
                    label={CONTRACT_STATUS[contract.status].label}
                    tone={CONTRACT_STATUS[contract.status].tone}
                  />
                </td>
                <td className="px-5 py-4 text-[#858a82]">
                  {formatDateTime(contract.createdAt)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {!contracts.length && <EmptyState label="No contracts yet." />}
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
                    label={CONTRACT_STATUS[selected.status].label}
                    tone={CONTRACT_STATUS[selected.status].tone}
                  />
                  <span className="text-[10px] text-[#858a82]">
                    {TALENT_KIND_LABEL[selected.talentKind]}
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
                <Stat label="Value" value={selectedMoney?.total ?? "—"} />
                <Stat
                  label="Started"
                  value={formatDateTime(selected.startedAt)}
                />
                <Stat
                  label="Completed"
                  value={formatDateTime(selected.completedAt)}
                />
                <Stat
                  label="Created"
                  value={formatDateTime(selected.createdAt)}
                />
              </div>

              <Section title="Client">
                <div className="rounded-xl bg-[#f4f6f2] p-3 text-xs leading-6">
                  <p className="font-semibold">{selected.clientName}</p>
                  {selected.clientEmail && <p>{selected.clientEmail}</p>}
                </div>
              </Section>

              <Section title="Talent">
                <div className="flex items-center gap-3 rounded-xl bg-[#f4f6f2] p-3 text-xs">
                  {selected.talentAvatarUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={selected.talentAvatarUrl}
                      alt=""
                      className="h-9 w-9 rounded-full object-cover"
                    />
                  ) : (
                    <span className="flex h-9 w-9 items-center justify-center rounded-full bg-[#527a73] text-[9px] font-semibold text-white">
                      {initialsFor(selected.talentName)}
                    </span>
                  )}
                  <div className="leading-6">
                    <p className="font-semibold">{selected.talentName}</p>
                    {selected.talentEmail && <p>{selected.talentEmail}</p>}
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
                </div>
              </Section>

              {selected.milestones.length > 0 && (
                <Section title={`Milestones (${selected.milestones.length})`}>
                  <div className="space-y-2">
                    {selected.milestones.map((milestone) => (
                      <div
                        key={milestone.id}
                        className="rounded-xl bg-[#f4f6f2] px-3 py-2.5 text-xs"
                      >
                        <div className="flex items-center justify-between gap-3">
                          <span className="min-w-0 truncate font-semibold">
                            {milestone.title}
                          </span>
                          <Badge
                            label={milestone.status}
                            tone={MILESTONE_TONE[milestone.status] ?? "gray"}
                          />
                        </div>
                        <p className="mt-1 text-[10px] text-[#858a82]">
                          {selectedMoney?.milestones.find(
                            (item) => item.id === milestone.id,
                          )?.amount ?? "—"}{" "}
                          · due {formatDate(milestone.dueDate)}
                          {milestone.fundedAt &&
                            ` · funded ${formatDateTime(milestone.fundedAt)}`}
                          {milestone.completedAt &&
                            ` · completed ${formatDateTime(milestone.completedAt)}`}
                        </p>
                        {milestone.submissionMessage && (
                          <p className="mt-1.5 text-[10px] text-[#71766e]">
                            {milestone.submissionMessage}
                          </p>
                        )}
                        {milestone.submissionDeliveryLink && (
                          <a
                            href={milestone.submissionDeliveryLink}
                            target="_blank"
                            rel="noreferrer"
                            className="mt-1 inline-block text-[10px] text-[#52784f] hover:underline"
                          >
                            {milestone.submissionDeliveryLink}
                          </a>
                        )}
                      </div>
                    ))}
                  </div>
                </Section>
              )}

              <p className="mt-5 text-[10px] text-[#969b94]">
                Contract ID: {selected.id} · Job ID: {selected.jobId} · Proposal
                ID: {selected.proposalId}
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
