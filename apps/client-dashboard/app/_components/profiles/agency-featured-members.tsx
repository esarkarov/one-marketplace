"use client";

import { Icon } from "@iconify/react";
import Link from "next/link";
import { useState } from "react";
import {
  initialsOf,
  MEMBERS_COLLAPSED_COUNT,
  type AgencyMember,
} from "@onemarketplace/web-core";
import { memberProfileHref } from "@/lib/profiles";

const VISIBLE_SKILLS = 4;

export function AgencyFeaturedMembers({
  members,
}: {
  members: readonly AgencyMember[];
}) {
  const [expanded, setExpanded] = useState(false);
  const visibleMembers = expanded
    ? members
    : members.slice(0, MEMBERS_COLLAPSED_COUNT);
  const remainingCount = members.length - MEMBERS_COLLAPSED_COUNT;

  if (members.length === 0) {
    return (
      <p className="py-8 text-center text-sm text-[#858a82]">
        No agency members yet.
      </p>
    );
  }

  return (
    <>
      <div className="grid gap-3 sm:grid-cols-2">
        {visibleMembers.map((member) => {
          const visibleSkills = member.skills.slice(0, VISIBLE_SKILLS);
          const hiddenSkillCount = member.skills.length - visibleSkills.length;
          const href = memberProfileHref(member);

          return (
            <Link
              key={member.id}
              href={href ?? "#"}
              onClick={(event) => {
                if (!href) event.preventDefault();
              }}
              aria-label={`View ${member.name}'s public profile`}
              className="group flex flex-col gap-3 rounded-xl border border-black/7 p-4 transition-colors hover:border-[#9fb99c] hover:bg-[#f6f9f4]"
            >
              <div className="flex items-center gap-4">
                {member.avatarUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={member.avatarUrl}
                    alt=""
                    className="h-12 w-12 shrink-0 rounded-full object-cover"
                  />
                ) : (
                  <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-[#527a73] text-xs font-semibold text-white">
                    {initialsOf(member.name)}
                  </span>
                )}
                <div className="min-w-0 flex-1">
                  <h3 className="text-sm font-semibold">{member.name}</h3>
                  <p className="mt-1 truncate text-xs text-[#70766e]">
                    {member.role || "—"}
                  </p>
                </div>
                <Icon
                  icon="solar:arrow-right-up-linear"
                  width="18"
                  className="shrink-0 text-[#7d847b] transition-transform group-hover:-translate-y-0.5 group-hover:translate-x-0.5 group-hover:text-[#52784f]"
                />
              </div>

              {visibleSkills.length > 0 && (
                <div className="flex flex-wrap gap-1.5">
                  {visibleSkills.map((skill) => (
                    <span
                      key={skill}
                      className="rounded-full bg-[#edf3ea] px-2.5 py-1 text-[10px] font-medium text-[#527052]"
                    >
                      {skill}
                    </span>
                  ))}
                  {hiddenSkillCount > 0 && (
                    <span className="rounded-full bg-[#f3f5f1] px-2.5 py-1 text-[10px] font-medium text-[#70766e]">
                      +{hiddenSkillCount}
                    </span>
                  )}
                </div>
              )}

              <div className="flex items-center gap-4 border-t border-black/6 pt-3 text-[10px] text-[#70766e]">
                <span className="inline-flex items-center gap-1">
                  <Icon
                    icon="solar:star-bold"
                    width="13"
                    className="text-[#d4a934]"
                  />
                  {member.rating.toFixed(1)} rating
                </span>
                <span>{member.jobSuccessScore}% JSS</span>
                <span>
                  {member.completedProjects} project
                  {member.completedProjects === 1 ? "" : "s"}
                </span>
              </div>
            </Link>
          );
        })}
      </div>

      {members.length > MEMBERS_COLLAPSED_COUNT && (
        <div className="mt-5 flex justify-center border-t border-black/7 pt-5">
          <button
            type="button"
            onClick={() => setExpanded((current) => !current)}
            className="inline-flex h-10 cursor-pointer items-center gap-2 rounded-xl border border-black/10 px-4 text-xs font-semibold transition hover:bg-[#f6f8f4]"
          >
            <Icon
              icon={
                expanded
                  ? "solar:alt-arrow-up-linear"
                  : "solar:alt-arrow-down-linear"
              }
              width="16"
            />
            {expanded
              ? "Show fewer members"
              : `Show ${remainingCount} more members`}
          </button>
        </div>
      )}
    </>
  );
}
