"use client";

import { useCallback, useEffect, useState } from "react";
import { PageHeader } from "../../_components/admin-shell";
import { AdminIcon } from "../../_components/admin-icon";
import { formatDateTime, type Paths } from "@onemarketplace/api-client";
import { Badge, ErrorBanner } from "../../_components/ui";
import {
  BrowserApiError,
  getAdminJson,
  redirectToLogin,
} from "../../../lib/browser-api";

type OkData<T> = T extends {
  responses: { 200: { content: { "application/json": { data: infer D } } } };
}
  ? D
  : never;

type SystemHealth = OkData<Paths["/api/v1/admin/system/health"]["get"]>;
type CheckResult = SystemHealth["redis"];
type RedisKeys = OkData<Paths["/api/v1/admin/system/redis/keys"]["get"]>;
type RedisKeyDetail = OkData<
  Paths["/api/v1/admin/system/redis/keys/{key}"]["get"]
>;

interface Failure {
  message: string;
  requestId: string | undefined;
}

const toFailure = (error: unknown, fallback: string): Failure =>
  error instanceof BrowserApiError
    ? { message: error.message, requestId: error.requestId }
    : {
        message: error instanceof Error ? error.message : fallback,
        requestId: undefined,
      };

const REFRESH_MS = 10_000;

function formatUptime(seconds: number) {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  if (hours) return `${hours}h ${minutes}m`;
  return `${minutes}m ${seconds % 60}s`;
}

export function SystemsExplorer() {
  const [health, setHealth] = useState<SystemHealth | null>(null);
  const [healthError, setHealthError] = useState<Failure | null>(null);

  const [pattern, setPattern] = useState("*");
  const [keys, setKeys] = useState<RedisKeys["keys"] | null>(null);
  const [scanning, setScanning] = useState(false);
  const [scanError, setScanError] = useState<Failure | null>(null);
  const [truncated, setTruncated] = useState(false);

  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [keyDetail, setKeyDetail] = useState<RedisKeyDetail | null>(null);
  const [keyDetailError, setKeyDetailError] = useState<Failure | null>(null);

  const loadHealth = useCallback(async () => {
    try {
      setHealth(
        await getAdminJson<SystemHealth>("/api/system/health", {
          onUnauthenticated: redirectToLogin,
        }),
      );
      setHealthError(null);
    } catch (error) {
      setHealthError(toFailure(error, "Could not reach the server."));
    }
  }, []);

  useEffect(() => {
    const initial = setTimeout(loadHealth, 0);
    const interval = setInterval(loadHealth, REFRESH_MS);
    return () => {
      clearTimeout(initial);
      clearInterval(interval);
    };
  }, [loadHealth]);

  const scanKeys = useCallback(async () => {
    setScanning(true);
    setScanError(null);
    try {
      const result = await getAdminJson<RedisKeys>(
        `/api/system/redis/keys?pattern=${encodeURIComponent(pattern || "*")}`,
        { onUnauthenticated: redirectToLogin },
      );
      setKeys(result.keys);
      setTruncated(result.truncated);
    } catch (error) {
      setScanError(toFailure(error, "Redis scan failed."));
    } finally {
      setScanning(false);
    }
  }, [pattern]);

  useEffect(() => {
    const initial = setTimeout(scanKeys, 0);
    return () => clearTimeout(initial);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const inspectKey = useCallback(async (key: string) => {
    setSelectedKey(key);
    setKeyDetail(null);
    setKeyDetailError(null);
    try {
      setKeyDetail(
        await getAdminJson<RedisKeyDetail>(
          `/api/system/redis/keys/${encodeURIComponent(key)}`,
          { onUnauthenticated: redirectToLogin },
        ),
      );
    } catch (error) {
      setKeyDetailError(toFailure(error, "Could not load this key."));
    }
  }, []);

  return (
    <>
      <PageHeader
        eyebrow="Infrastructure"
        title="Systems"
        description="Redis, Postgres, and RabbitMQ health, machine load, and a live Redis explorer."
      />
      {healthError && <ErrorBanner {...healthError} />}

      {health && (
        <>
          <section className="mt-8 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <HealthCard icon="server" label="Redis" result={health.redis} />
            <HealthCard
              icon="server"
              label="Postgres"
              result={health.database}
            />
            <HealthCard
              icon="server"
              label="RabbitMQ"
              result={health.rabbitmq}
            />
            <article className="rounded-2xl border border-black/8 bg-white p-5">
              <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-[#edf4ea] text-[#52784f]">
                <AdminIcon name="trend" size={20} />
              </span>
              <p className="mt-5 text-2xl font-semibold tracking-[-.04em]">
                {formatUptime(health.process.uptimeSeconds)}
              </p>
              <h2 className="mt-1 text-xs font-semibold">API uptime</h2>
              <p className="mt-2 text-[10px] text-[#858a82]">
                Node {health.process.nodeVersion}
              </p>
            </article>
          </section>

          <section className="mt-5 grid gap-5 xl:grid-cols-2">
            <article className="rounded-2xl border border-black/8 bg-white p-5">
              <h2 className="font-semibold">Machine load</h2>
              <div className="mt-4 grid grid-cols-3 gap-3">
                <MiniStat
                  label="Load (1m)"
                  value={(health.process.loadAverage[0] ?? 0).toFixed(2)}
                />
                <MiniStat
                  label="Load (5m)"
                  value={(health.process.loadAverage[1] ?? 0).toFixed(2)}
                />
                <MiniStat
                  label="Load (15m)"
                  value={(health.process.loadAverage[2] ?? 0).toFixed(2)}
                />
              </div>
              <div className="mt-3 grid grid-cols-3 gap-3">
                <MiniStat
                  label="CPU cores"
                  value={String(health.process.cpuCount)}
                />
                <MiniStat
                  label="Free memory"
                  value={`${health.process.freeMemoryMb.toLocaleString()} MB`}
                />
                <MiniStat
                  label="Total memory"
                  value={`${health.process.totalMemoryMb.toLocaleString()} MB`}
                />
              </div>
              <p className="mt-4 text-[10px] text-[#969b94]">
                Last checked {formatDateTime(health.checkedAt)} · refreshes
                every 10s
              </p>
            </article>

            <article className="rounded-2xl border border-black/8 bg-white p-5">
              <h2 className="font-semibold">API process memory</h2>
              <div className="mt-4 grid grid-cols-3 gap-3">
                <MiniStat
                  label="RSS"
                  value={`${Math.round(health.process.memory.rss / 1024 / 1024)} MB`}
                />
                <MiniStat
                  label="Heap used"
                  value={`${Math.round(health.process.memory.heapUsed / 1024 / 1024)} MB`}
                />
                <MiniStat
                  label="Heap total"
                  value={`${Math.round(health.process.memory.heapTotal / 1024 / 1024)} MB`}
                />
              </div>
            </article>
          </section>
        </>
      )}

      <section className="mt-5 overflow-hidden rounded-2xl border border-black/8 bg-white">
        <header className="flex flex-col gap-3 border-b border-black/7 p-5 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="font-semibold">Redis explorer</h2>
            <p className="mt-1 text-xs text-[#7c8179]">
              Scan keys currently stored in Redis
            </p>
          </div>
          <div className="flex gap-2">
            <input
              value={pattern}
              onChange={(event) => setPattern(event.target.value)}
              onKeyDown={(event) => event.key === "Enter" && void scanKeys()}
              placeholder="Pattern, e.g. session:*"
              className="h-10 w-56 rounded-xl border border-black/9 px-3 text-xs outline-none"
            />
            <button
              type="button"
              onClick={() => void scanKeys()}
              disabled={scanning}
              className="h-10 rounded-xl bg-[#252724] px-4 text-xs font-semibold text-white disabled:opacity-60"
            >
              {scanning ? "Scanning…" : "Scan"}
            </button>
          </div>
        </header>

        {scanError && <ErrorBanner {...scanError} />}

        <div className="grid xl:grid-cols-[1fr_1.2fr]">
          <div className="max-h-100 overflow-y-auto border-b border-black/7 xl:border-r xl:border-b-0">
            <table className="w-full border-collapse text-left text-xs">
              <thead className="sticky top-0 bg-[#fafbf9] text-[10px] font-semibold tracking-[.08em] text-[#7c8179] uppercase">
                <tr>
                  <th className="px-5 py-3">Key</th>
                  <th className="px-5 py-3">Type</th>
                  <th className="px-5 py-3">TTL</th>
                </tr>
              </thead>
              <tbody>
                {(keys ?? []).map((row) => (
                  <tr
                    key={row.key}
                    onClick={() => void inspectKey(row.key)}
                    className={`cursor-pointer border-t border-black/6 hover:bg-[#fafbf9] ${
                      selectedKey === row.key ? "bg-[#edf4ea]" : ""
                    }`}
                  >
                    <td className="max-w-56 truncate px-5 py-3 font-mono">
                      {row.key}
                    </td>
                    <td className="px-5 py-3 text-[#71766e]">{row.type}</td>
                    <td className="px-5 py-3 text-[#71766e]">
                      {row.ttl < 0 ? "No expiry" : `${row.ttl}s`}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {keys && !keys.length && (
              <div className="p-8 text-center text-sm text-[#7c8179]">
                No keys match this pattern.
              </div>
            )}
            {truncated && (
              <p className="px-5 py-3 text-[10px] text-[#969b94]">
                Showing a partial scan — narrow your pattern to see more.
              </p>
            )}
          </div>

          <div className="p-5">
            {!selectedKey && (
              <p className="text-sm text-[#7c8179]">
                Select a key on the left to inspect its value.
              </p>
            )}
            {selectedKey && (
              <>
                <div className="flex items-center justify-between gap-3">
                  <h3 className="truncate font-mono text-xs font-semibold">
                    {selectedKey}
                  </h3>
                  {keyDetail && <Badge label={keyDetail.type} tone="blue" />}
                </div>
                {keyDetailError && (
                  <div className="mt-3 text-xs text-[#9a5953]">
                    {keyDetailError.message}
                    {keyDetailError.requestId && (
                      <p className="mt-1 text-[10px] text-[#b08a86]">
                        Request ID: {keyDetailError.requestId}
                      </p>
                    )}
                  </div>
                )}
                {keyDetail && (
                  <>
                    <p className="mt-2 text-[10px] text-[#969b94]">
                      TTL:{" "}
                      {keyDetail.ttl < 0 ? "No expiry" : `${keyDetail.ttl}s`}
                    </p>
                    <pre className="mt-3 max-h-96 overflow-auto rounded-xl bg-[#f4f6f2] p-4 text-[11px] leading-5 whitespace-pre-wrap">
                      {typeof keyDetail.value === "string"
                        ? keyDetail.value
                        : JSON.stringify(keyDetail.value, null, 2)}
                    </pre>
                    {keyDetail.truncated && (
                      <p className="mt-2 text-[10px] text-[#969b94]">
                        Value truncated for preview.
                      </p>
                    )}
                  </>
                )}
              </>
            )}
          </div>
        </div>
      </section>
    </>
  );
}

function HealthCard({
  icon,
  label,
  result,
  detail,
}: {
  icon: "server";
  label: string;
  result: CheckResult;
  detail?: string;
}) {
  return (
    <article className="rounded-2xl border border-black/8 bg-white p-5">
      <div className="flex items-start justify-between">
        <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-[#edf4ea] text-[#52784f]">
          <AdminIcon name={icon} size={20} />
        </span>
        <Badge
          label={result.ok ? "Healthy" : "Down"}
          tone={result.ok ? "green" : "red"}
        />
      </div>
      <p className="mt-5 text-2xl font-semibold tracking-[-.04em]">
        {result.ok ? `${result.latencyMs ?? 0}ms` : "—"}
      </p>
      <h2 className="mt-1 text-xs font-semibold">{label}</h2>
      <p className="mt-2 truncate text-[10px] text-[#858a82]">
        {result.ok ? (detail ?? "Responding normally") : "Not responding"}
      </p>
    </article>
  );
}

function MiniStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl bg-[#f3f5f1] p-3">
      <p className="text-lg font-semibold tracking-[-.03em]">{value}</p>
      <p className="mt-1 text-[9px] text-[#7c8179]">{label}</p>
    </div>
  );
}
