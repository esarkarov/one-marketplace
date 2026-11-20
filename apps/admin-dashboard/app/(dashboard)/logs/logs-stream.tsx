"use client";

import { useEffect, useRef, useState } from "react";
import { PageHeader } from "../../_components/admin-shell";
import { AdminIcon } from "../../_components/admin-icon";
import { Badge, ErrorBanner } from "../../_components/ui";

interface LogEvent {
  id: string;
  timestamp: string;
  level: "trace" | "debug" | "info" | "warn" | "error" | "fatal";
  message: string;
  eventName: string | null;
  serviceName: string;
  environment: string | null;
  attributes: Record<string, unknown>;
}

const LEVEL_TONE: Record<LogEvent["level"], "gray" | "blue" | "amber" | "red"> =
  {
    trace: "gray",
    debug: "gray",
    info: "blue",
    warn: "amber",
    error: "red",
    fatal: "red",
  };

const MAX_ENTRIES = 300;

export function LogsStream() {
  const [entries, setEntries] = useState<LogEvent[]>([]);
  const [connected, setConnected] = useState(false);
  const [error, setError] = useState("");
  const seenIds = useRef(new Set<string>());
  const [selected, setSelected] = useState<LogEvent | null>(null);

  useEffect(() => {
    if (!selected) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setSelected(null);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [selected]);

  useEffect(() => {
    const source = new EventSource("/api/logs/stream");

    source.onopen = () => {
      setConnected(true);
      setError("");
    };
    source.onerror = () => {
      setConnected(false);
      setError(
        source.readyState === EventSource.CLOSED
          ? "Log stream closed. Reload the page or sign in again."
          : "Log stream disconnected — retrying…",
      );
    };
    source.onmessage = (event) => {
      try {
        const parsed = JSON.parse(event.data) as LogEvent;
        if (seenIds.current.has(parsed.id)) return;
        seenIds.current.add(parsed.id);
        setEntries((current) => [parsed, ...current].slice(0, MAX_ENTRIES));
      } catch {
        // Ignore malformed frames.
      }
    };

    return () => source.close();
  }, []);

  return (
    <>
      <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
        <PageHeader
          eyebrow="Observability"
          title="Logs"
          description="Live tail of OneMinute Logs — newest first."
        />
        <span
          className={`inline-flex h-9 shrink-0 items-center gap-2 rounded-xl px-3 text-xs font-semibold ${
            connected
              ? "bg-[#edf4ea] text-[#52784f]"
              : "bg-[#f5f0de] text-[#82723f]"
          }`}
        >
          <span
            className={`h-2 w-2 rounded-full ${connected ? "bg-[#5f8d5c]" : "bg-[#c48b48]"}`}
          />
          {connected ? "Live" : "Connecting…"}
        </span>
      </div>

      {error && <ErrorBanner message={error} />}

      <section className="mt-8 overflow-hidden rounded-2xl border border-black/8 bg-white">
        <header className="border-b border-black/7 p-5">
          <h2 className="font-semibold">Live stream</h2>
          <p className="mt-1 text-xs text-[#7c8179]">
            Showing the last {MAX_ENTRIES} events received this session
          </p>
        </header>
        <div className="max-h-[70vh] overflow-y-auto font-mono text-[11px]">
          {entries.map((entry) => (
            <button
              key={entry.id}
              type="button"
              onClick={() => setSelected(entry)}
              className="flex w-full flex-wrap items-start gap-3 border-t border-black/6 px-5 py-3 text-left first:border-t-0 hover:bg-[#fafbf9]"
            >
              <span className="shrink-0 text-[#969b94]">
                {new Date(entry.timestamp).toLocaleTimeString()}
              </span>
              <Badge
                label={entry.level.toUpperCase()}
                tone={LEVEL_TONE[entry.level]}
              />
              {entry.eventName && (
                <span className="shrink-0 text-[#7c8179]">
                  {entry.eventName}
                </span>
              )}
              <span className="min-w-0 flex-1 wrap-break-word text-[#2c2f2a]">
                {entry.message}
              </span>
            </button>
          ))}
          {!entries.length && (
            <div className="p-10 text-center text-sm text-[#7c8179]">
              Waiting for log events…
            </div>
          )}
        </div>
      </section>

      {selected && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-5"
          onClick={() => setSelected(null)}
        >
          <div
            onClick={(event) => event.stopPropagation()}
            className="flex max-h-[80vh] w-full max-w-2xl flex-col overflow-hidden rounded-2xl bg-white shadow-2xl"
          >
            <header className="flex items-center justify-between gap-3 border-b border-black/7 p-5">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <Badge
                    label={selected.level.toUpperCase()}
                    tone={LEVEL_TONE[selected.level]}
                  />
                  {selected.eventName && (
                    <span className="text-xs text-[#7c8179]">
                      {selected.eventName}
                    </span>
                  )}
                </div>
                <h2 className="mt-2 truncate text-sm font-semibold">
                  {selected.message}
                </h2>
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
            <pre className="overflow-auto p-5 font-mono text-[11px] leading-5 whitespace-pre-wrap text-[#2c2f2a]">
              {JSON.stringify(selected, null, 2)}
            </pre>
          </div>
        </div>
      )}
    </>
  );
}
