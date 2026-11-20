import Link from "next/link";
import { errorMessage, isApiError } from "@onemarketplace/api-client";

export function ErrorBanner({
  message,
  requestId,
}: {
  message: string;
  requestId?: string | undefined;
}) {
  return (
    <div
      role="alert"
      className="mt-5 rounded-2xl border border-[#ead7d5] bg-[#fff8f7] px-5 py-4 text-sm text-[#9a5953]"
    >
      {message}
      {requestId && (
        <p className="mt-1 text-[10px] text-[#b08a86]">
          Request ID: {requestId}
        </p>
      )}
    </div>
  );
}

export function ApiErrorBanner({ error }: { error: unknown }) {
  return (
    <ErrorBanner
      message={errorMessage(error)}
      requestId={isApiError(error) ? error.requestId : undefined}
    />
  );
}

export function EmptyState({ label }: { label: string }) {
  return <div className="p-12 text-center text-sm text-[#7c8179]">{label}</div>;
}

const TONES = {
  green: "bg-[#edf4ea] text-[#52784f]",
  amber: "bg-[#f5f0de] text-[#82723f]",
  red: "bg-[#f8eceb] text-[#9a5953]",
  gray: "bg-[#f1f3ef] text-[#71766e]",
  blue: "bg-[#e8eef4] text-[#4a6e8f]",
} as const;

export function Badge({
  label,
  tone,
}: {
  label: string;
  tone: keyof typeof TONES;
}) {
  return (
    <span
      className={`rounded-full px-2.5 py-1 text-[9px] font-semibold ${TONES[tone]}`}
    >
      {label}
    </span>
  );
}

export function TableShell({
  title,
  description,
  count,
  children,
  footer,
}: {
  title: string;
  description: string;
  count?: number;
  children: React.ReactNode;
  footer?: React.ReactNode;
}) {
  return (
    <section className="mt-8 overflow-hidden rounded-2xl border border-black/8 bg-white">
      <header className="flex flex-col gap-1 border-b border-black/7 p-5">
        <div className="flex items-center justify-between gap-3">
          <h2 className="font-semibold">{title}</h2>
          {typeof count === "number" && (
            <span className="text-xs text-[#858a82]">{count} shown</span>
          )}
        </div>
        <p className="text-xs text-[#7c8179]">{description}</p>
      </header>
      <div className="overflow-x-auto">{children}</div>
      {footer}
    </section>
  );
}

// Server-renderable — Prev/Next are plain links that change the `offset`
// query param, so pages stay simple Server Components with no client JS
// needed just for pagination.
export function Pagination({
  offset,
  limit,
  count,
  hasMore,
  basePath,
}: {
  offset: number;
  limit: number;
  count: number;
  hasMore: boolean;
  basePath: string;
}) {
  const atStart = offset === 0;
  const prevOffset = Math.max(0, offset - limit);
  const nextOffset = offset + limit;

  return (
    <div className="flex items-center justify-between gap-3 border-t border-black/7 px-5 py-4">
      {atStart ? (
        <span className="h-9 rounded-xl border border-black/9 px-4 text-xs font-semibold flex items-center opacity-40">
          Previous
        </span>
      ) : (
        <Link
          href={`${basePath}?offset=${prevOffset}`}
          className="h-9 rounded-xl border border-black/9 px-4 text-xs font-semibold flex items-center hover:bg-[#f5f6f3]"
        >
          Previous
        </Link>
      )}
      <span className="text-xs text-[#858a82]">
        {count > 0 ? `Showing ${offset + 1}–${offset + count}` : "No results"}
      </span>
      {hasMore ? (
        <Link
          href={`${basePath}?offset=${nextOffset}`}
          className="h-9 rounded-xl border border-black/9 px-4 text-xs font-semibold flex items-center hover:bg-[#f5f6f3]"
        >
          Next
        </Link>
      ) : (
        <span className="h-9 rounded-xl border border-black/9 px-4 text-xs font-semibold flex items-center opacity-40">
          Next
        </span>
      )}
    </div>
  );
}
