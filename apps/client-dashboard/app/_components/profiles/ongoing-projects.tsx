"use client";

import { Icon } from "@iconify/react";
import { formatCents } from "@onemarketplace/api-client";
import {
  ONGOING_PAGE_SIZE,
  ongoingStarted,
  paginate,
  type OngoingEntry,
} from "@onemarketplace/web-core";
import { useState } from "react";

export function OngoingProjects({
  projects,
}: {
  projects: readonly OngoingEntry[];
}) {
  const [requestedPage, setRequestedPage] = useState(1);
  if (!projects.length) return null;
  const view = paginate(projects, requestedPage, ONGOING_PAGE_SIZE);

  return (
    <section className="rounded-2xl border border-black/8 bg-white p-5 sm:p-6">
      <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-[10px] font-semibold tracking-[.13em] text-[#62805f] uppercase">
            In progress
          </p>
          <h2 className="mt-2 text-xl font-semibold">Ongoing projects</h2>
        </div>
        <p className="text-xs text-[#8a8f87]">
          {view.total} active {view.total === 1 ? "project" : "projects"}
        </p>
      </div>

      <div className="grid gap-4">
        {view.items.map((project) => (
          <article
            key={project.id}
            className="rounded-xl border border-black/7 p-5"
          >
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <div className="flex items-center gap-2">
                  <h3 className="text-sm font-semibold">{project.title}</h3>
                  <span className="inline-flex items-center gap-1 rounded-md bg-[#edf4ea] px-2 py-0.5 text-[10px] font-semibold text-[#52784f]">
                    <Icon icon="solar:clock-circle-linear" width="12" />
                    In progress
                  </span>
                </div>
                <p className="mt-1 text-xs text-[#7b8078]">
                  {project.client}
                  {project.createdAt !== undefined &&
                    ` · Started ${ongoingStarted(project)}`}
                </p>
              </div>
              <p className="text-sm font-semibold">
                {formatCents(project.amountCents)}
              </p>
            </div>
          </article>
        ))}
      </div>

      {view.totalPages > 1 && (
        <div className="mt-5 flex items-center justify-between gap-3 border-t border-black/7 pt-5">
          <p className="text-xs text-[#838980]">
            Showing {view.from}–{view.to} of {view.total}
          </p>
          <nav
            aria-label="Ongoing projects pagination"
            className="flex items-center gap-2"
          >
            <button
              type="button"
              aria-label="Previous ongoing projects page"
              disabled={view.page === 1}
              onClick={() => setRequestedPage(view.page - 1)}
              className="flex h-9 w-9 items-center justify-center rounded-lg border border-black/10 disabled:cursor-not-allowed disabled:opacity-35"
            >
              <Icon icon="solar:alt-arrow-left-linear" width="16" />
            </button>
            <span className="text-xs font-semibold text-[#656b63]">
              Page {view.page} of {view.totalPages}
            </span>
            <button
              type="button"
              aria-label="Next ongoing projects page"
              disabled={view.page === view.totalPages}
              onClick={() => setRequestedPage(view.page + 1)}
              className="flex h-9 w-9 items-center justify-center rounded-lg border border-black/10 disabled:cursor-not-allowed disabled:opacity-35"
            >
              <Icon icon="solar:alt-arrow-right-linear" width="16" />
            </button>
          </nav>
        </div>
      )}
    </section>
  );
}
