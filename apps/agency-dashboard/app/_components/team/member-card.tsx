"use client";

import { Icon } from "../ui/icon";
import type { TeamRow } from "./types";

const getInitials = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((word) => word[0]?.toUpperCase())
    .join("") || "?";

export function MemberCard({
  row,
  onView,
}: {
  row: TeamRow;
  onView: (row: TeamRow) => void;
}) {
  const pending = row.kind === "invitation";
  const name = pending ? row.email : row.name;

  return (
    <article className="rounded-2xl border border-black/8 bg-white p-5">
      <div className="flex items-start gap-3">
        <span className="relative flex h-12 w-12 shrink-0 items-center justify-center overflow-hidden rounded-full bg-[#496e67] text-xs font-semibold text-white">
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
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="truncate font-semibold">{name}</h2>
            {!pending && row.isOwner && (
              <Icon name="verified" size={15} className="text-[#52784f]" />
            )}
          </div>
          <p className="mt-1 truncate text-xs text-[#6f756d]">
            {pending ? row.email : `${row.completedProjects} completed projects`}
          </p>
        </div>
      </div>

      <div className="mt-5 flex items-center justify-between">
        <span
          className={`rounded-full px-2.5 py-1 text-[10px] font-semibold ${
            pending
              ? "bg-[#f2efe3] text-[#796f42]"
              : "bg-[#e6f2e3] text-[#477344]"
          }`}
        >
          {pending ? "Invitation pending" : "Active"}
        </span>
        <span className="text-[11px] font-medium text-[#6f756d]">
          {row.role}
        </span>
      </div>

      {!pending && (
        <div className="mt-5 flex flex-wrap gap-1.5">
          {row.skills.slice(0, 3).map((skill) => (
            <span
              key={skill}
              className="rounded-lg bg-[#edf1eb] px-2 py-1 text-[10px] text-[#626960]"
            >
              {skill}
            </span>
          ))}
          {row.skills.length > 3 && (
            <span className="rounded-lg bg-[#edf1eb] px-2 py-1 text-[10px] text-[#626960]">
              +{row.skills.length - 3}
            </span>
          )}
          {row.skills.length === 0 && (
            <span className="text-[10px] text-[#9a9f97]">
              No skills listed yet
            </span>
          )}
        </div>
      )}

      <button
        type="button"
        onClick={() => onView(row)}
        className="mt-5 h-10 w-full cursor-pointer rounded-xl border border-black/10 text-xs font-semibold hover:bg-black/3"
      >
        {pending ? "Manage invitation" : "View member"}
      </button>
    </article>
  );
}
