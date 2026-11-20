"use client";

import { useState } from "react";
import { AdminIcon } from "../_components/admin-icon";

export default function LoginPage() {
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!password || submitting) return;
    setSubmitting(true);
    setError("");
    try {
      const response = await fetch("/api/session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
      });
      const result = await response.json();
      if (!response.ok || !result.success) {
        throw new Error(result.message || "Incorrect password.");
      }
      const next = new URLSearchParams(window.location.search).get("next");
      window.location.href = next && next.startsWith("/") ? next : "/";
    } catch (err) {
      setError(err instanceof Error ? err.message : "Incorrect password.");
      setSubmitting(false);
    }
  };

  return (
    <div className="flex min-h-svh items-center justify-center bg-[#f4f6f2] p-5">
      <div className="w-full max-w-sm rounded-2xl border border-black/8 bg-white p-7 shadow-2xl">
        <div className="flex items-center gap-2.5">
          <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-[#252724] text-white">
            <AdminIcon name="grid" size={18} />
          </span>
          <span className="text-lg font-semibold">OneMarketplace.io</span>
        </div>
        <p className="mt-5 text-xs font-semibold tracking-[.14em] text-[#62805f] uppercase">
          Operations console
        </p>
        <h1 className="mt-2 text-2xl font-semibold tracking-[-.03em]">
          Admin access
        </h1>
        <p className="mt-2 text-sm text-[#72776f]">
          Enter the admin password to continue.
        </p>

        <form onSubmit={submit} className="mt-6 space-y-3">
          <input
            type="password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            placeholder="Password"
            autoFocus
            className="h-11 w-full rounded-xl border border-black/10 px-3 text-sm outline-none focus:border-[#668c63]"
          />
          {error && <p className="text-xs text-[#9a5953]">{error}</p>}
          <button
            type="submit"
            disabled={!password || submitting}
            className="h-11 w-full rounded-xl bg-[#252724] text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-60"
          >
            {submitting ? "Checking…" : "Enter"}
          </button>
        </form>
      </div>
    </div>
  );
}
