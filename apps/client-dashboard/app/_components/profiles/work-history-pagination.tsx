"use client";

import { Icon } from "@iconify/react";
import { useState } from "react";
import {
  completedWork,
  formatRating,
  paginate,
  WORK_HISTORY_PAGE_SIZE,
  type WorkEntry,
} from "@/lib/profiles";

export function WorkHistoryPagination({
  averageRating,
  workHistory,
}: {
  averageRating: number | null;
  workHistory: readonly WorkEntry[];
}) {
  const [requestedPage, setRequestedPage] = useState(1);
  const work = completedWork(workHistory);
  const view = paginate(work, requestedPage, WORK_HISTORY_PAGE_SIZE);

  return (
    <section className="rounded-2xl border border-black/8 bg-white p-5 sm:p-6">
      <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-[10px] font-semibold tracking-[.13em] text-[#62805f] uppercase">
            Client feedback
          </p>
          <h2 className="mt-2 text-xl font-semibold">
            Completed work and reviews
          </h2>
        </div>
        <p className="text-xs text-[#8a8f87]">
          {formatRating(averageRating)} average rating
        </p>
      </div>

      <div className="grid gap-4">
        {view.items.map((item) => (
          <article
            key={item.id}
            className="rounded-xl border border-black/7 p-5"
          >
            <div className="flex flex-wrap justify-between gap-3">
              <div>
                <h3 className="text-sm font-semibold">{item.project}</h3>
                <p className="mt-1 text-xs text-[#7b8078]">
                  {item.client} · Completed {item.completed}
                </p>
              </div>
              <div className="text-right">
                <p className="text-sm font-semibold">{item.budget}</p>
                <span className="mt-1 flex items-center justify-end gap-1 text-xs font-semibold">
                  <Icon
                    icon="solar:star-bold"
                    width="15"
                    className="text-[#d4a934]"
                  />
                  {item.rating}
                </span>
              </div>
            </div>
            {item.review && (
              <p className="mt-4 text-sm leading-7 text-[#626861]">
                “{item.review}”
              </p>
            )}
          </article>
        ))}
        {!view.items.length && (
          <p className="rounded-xl border border-dashed border-black/10 p-8 text-center text-sm text-[#838980]">
            No completed work yet.
          </p>
        )}
      </div>

      {view.total > 0 && (
        <div className="mt-5 flex flex-col gap-3 border-t border-black/7 pt-5 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-xs text-[#838980]">
            Showing {view.from}–{view.to} of {view.total} completed projects
          </p>
          <nav
            aria-label="Work history pagination"
            className="flex items-center gap-2"
          >
            <button
              type="button"
              aria-label="Previous work history page"
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
              aria-label="Next work history page"
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
