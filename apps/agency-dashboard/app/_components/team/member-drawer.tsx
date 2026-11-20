"use client";

import { useState } from "react";
import { Icon } from "../ui/icon";
import type { TeamRow } from "./types";

const getInitials = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((word) => word[0]?.toUpperCase())
    .join("") || "?";

export function MemberDrawer({
  row,
  onClose,
  onUpdateRole,
  onRemove,
  onResend,
  onCancel,
}: {
  row: TeamRow;
  onClose: () => void;
  onUpdateRole: (row: TeamRow, role: "Business manager" | "Agency member") => void;
  onRemove: (row: TeamRow) => void;
  onResend: (row: TeamRow) => void;
  onCancel: (row: TeamRow) => void;
}) {
  const pending = row.kind === "invitation";
  const owner = row.kind === "member" && row.isOwner;
  const name = pending ? row.email : row.name;
  const [resending, setResending] = useState(false);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="member-title"
      className="fixed inset-0 z-50 flex justify-end bg-[#172018]/45 backdrop-blur-[2px]"
    >
      <div className="h-full w-full max-w-xl overflow-y-auto bg-white shadow-2xl">
        <header className="sticky top-0 z-10 flex items-start justify-between border-b border-black/8 bg-white px-6 py-5 sm:px-8">
          <div>
            <p className="text-xs font-semibold tracking-wide text-[#62805f] uppercase">
              Agency member
            </p>
            <h2 id="member-title" className="mt-2 text-xl font-semibold">
              {pending ? "Manage invitation" : "Member details"}
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="cursor-pointer"
          >
            <Icon name="close" size={25} />
          </button>
        </header>

        <div className="grid gap-7 p-6 sm:p-8">
          <section className="flex items-center gap-4 rounded-2xl bg-[#f1f5ef] p-5">
            <span className="flex h-14 w-14 shrink-0 items-center justify-center overflow-hidden rounded-full bg-[#496e67] text-sm font-semibold text-white">
              {row.avatarUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={row.avatarUrl}
                  alt=""
                  className="h-full w-full object-cover"
                />
              ) : (
                getInitials(name)
              )}
            </span>
            <div className="min-w-0">
              <h3 className="truncate font-semibold">{name}</h3>
              <p className="mt-1 truncate text-xs text-[#858a82]">
                {pending ? row.email : `${row.jobSuccessScore}% job success`}
              </p>
            </div>
          </section>

          {pending ? (
            <>
              <section>
                <h3 className="text-sm font-semibold">Invitation status</h3>
                <div className="mt-3 rounded-xl border border-[#dfd3a9] bg-[#faf7eb] p-4">
                  <p className="text-sm font-semibold text-[#6f653d]">
                    Waiting for {name} to join
                  </p>
                  <p className="mt-1 text-xs leading-5 text-[#7a745f]">
                    An invitation was sent to {row.email}. They must accept it
                    from their freelancer dashboard before appearing on your
                    public agency profile.
                  </p>
                </div>
              </section>
              <section>
                <h3 className="text-sm font-semibold">Planned account role</h3>
                <select
                  value={row.role}
                  onChange={(event) =>
                    onUpdateRole(
                      row,
                      event.target.value as "Business manager" | "Agency member",
                    )
                  }
                  className="mt-3 h-11 w-full rounded-xl border border-black/10 bg-white px-3 text-sm outline-none"
                >
                  <option>Agency member</option>
                  <option>Business manager</option>
                </select>
              </section>
              <div className="flex gap-2">
                <button
                  type="button"
                  disabled={resending}
                  onClick={() => {
                    setResending(true);
                    onResend(row);
                  }}
                  className="h-11 flex-1 cursor-pointer rounded-xl bg-[#252724] px-4 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {resending ? "Resending…" : "Resend invitation"}
                </button>
                <button
                  type="button"
                  onClick={() => onCancel(row)}
                  className="h-11 cursor-pointer rounded-xl border border-[#d8bcbc] px-4 text-sm font-semibold text-[#8b5656]"
                >
                  Cancel invite
                </button>
              </div>
            </>
          ) : (
            <>
              <section>
                <h3 className="text-sm font-semibold">Public agency profile</h3>
                <div className="mt-3 grid grid-cols-2 gap-3">
                  {[
                    ["Rating", row.rating ? row.rating.toFixed(1) : "Not rated"],
                    ["Job success", `${row.jobSuccessScore}%`],
                    ["Completed projects", String(row.completedProjects)],
                  ].map(([label, value]) => (
                    <div
                      key={label}
                      className="rounded-xl border border-black/7 p-3"
                    >
                      <p className="text-[10px] text-[#858a82]">{label}</p>
                      <p className="mt-1.5 text-xs font-semibold">{value}</p>
                    </div>
                  ))}
                </div>
                <div className="mt-3 flex flex-wrap gap-2">
                  {row.skills.length > 0 ? (
                    row.skills.map((skill) => (
                      <span
                        key={skill}
                        className="rounded-lg bg-[#edf2eb] px-2.5 py-1.5 text-xs"
                      >
                        {skill}
                      </span>
                    ))
                  ) : (
                    <p className="text-xs text-[#9a9f97]">
                      No skills listed on their profile yet.
                    </p>
                  )}
                </div>
              </section>

              <section>
                <h3 className="text-sm font-semibold">Agency account role</h3>
                <select
                  disabled={owner}
                  value={row.role}
                  onChange={(event) =>
                    onUpdateRole(
                      row,
                      event.target.value as "Business manager" | "Agency member",
                    )
                  }
                  className="mt-3 h-11 w-full rounded-xl border border-black/10 bg-white px-3 text-sm outline-none disabled:bg-[#f1f3ef] disabled:text-[#7b8078]"
                >
                  {owner && <option>Agency owner</option>}
                  <option>Business manager</option>
                  <option>Agency member</option>
                </select>
                <p className="mt-2 text-[11px] leading-5 text-[#858a82]">
                  {owner
                    ? "The agency owner cannot be reassigned or removed."
                    : "Roles control access to the agency account, not internal project assignments."}
                </p>
              </section>

              {!owner && (
                <section className="border-t border-black/7 pt-6">
                  <button
                    type="button"
                    onClick={() => onRemove(row)}
                    className="cursor-pointer text-xs font-semibold text-[#8b5656] hover:underline"
                  >
                    Remove from agency
                  </button>
                </section>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
