"use client";

import { Icon } from "@iconify/react";
import { useState } from "react";
import { useAuth } from "@clerk/nextjs";

type EarningsStatementModalProps = {
  onClose: () => void;
};

export function EarningsStatementModal({
  onClose,
}: EarningsStatementModalProps) {
  const { getToken } = useAuth();
  const [downloading, setDownloading] = useState(false);
  const [error, setError] = useState("");

  const downloadCertificate = async () => {
    setDownloading(true);
    setError("");
    try {
      const token = await getToken();
      const response = await fetch(
        `${process.env.NEXT_PUBLIC_SERVER_URI}/freelancer/earnings/certificate?role=freelancer`,
        {
          headers: { Authorization: `Bearer ${token}` },
        },
      );

      if (!response.ok) {
        const result = await response.json().catch(() => null);
        throw new Error(
          result?.message || "The earnings certificate could not be generated.",
        );
      }

      const disposition = response.headers.get("Content-Disposition") ?? "";
      const fileName =
        /filename="([^"]+)"/.exec(disposition)?.[1] ??
        "OneMarketplace-Earnings-Certificate.pdf";

      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = fileName;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(url);
      onClose();
    } catch (error) {
      setError(
        error instanceof Error
          ? error.message
          : "The earnings certificate could not be generated.",
      );
    } finally {
      setDownloading(false);
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="statement-title"
      className="fixed inset-0 z-60 grid place-items-center bg-[#172018]/45 p-5 backdrop-blur-[2px]"
    >
      <div className="w-full max-w-lg rounded-2xl bg-white p-6 shadow-2xl sm:p-7">
        <div className="flex items-start justify-between">
          <div>
            <p className="text-xs font-semibold tracking-wide text-[#62805f] uppercase">
              Verified document
            </p>
            <h2 id="statement-title" className="mt-2 text-xl font-semibold">
              Earnings certificate
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="cursor-pointer"
          >
            <Icon icon="solar:close-circle-linear" width="25" />
          </button>
        </div>

        <p className="mt-4 text-sm leading-6 text-[#737870]">
          Download a signed PDF certificate confirming your marketplace
          earnings and professional freelance activity on OneMarketplace.io —
          useful for visa, loan, or income verification purposes.
        </p>

        <div className="mt-5 rounded-2xl border border-black/8 bg-[#f5f7f3] p-5">
          <div className="flex items-center gap-3">
            <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-[#e3efe0] text-[#4d784a]">
              <Icon icon="solar:document-text-bold" width="22" />
            </span>
            <div>
              <p className="text-sm font-semibold">
                Statement of Earnings (PDF)
              </p>
              <p className="mt-0.5 text-[11px] text-[#7b8078]">
                Signed by OneMinute Stack Inc.
              </p>
            </div>
          </div>
          <p className="mt-4 border-t border-black/7 pt-4 text-xs leading-5 text-[#7b8078]">
            The certificate includes your name, title, location, when you
            joined OneMarketplace.io, and payments received this month,
            quarter, half-year, and year — generated fresh from your account
            records.
          </p>
        </div>

        {error && <p className="mt-4 text-xs text-red-600">{error}</p>}

        <div className="mt-6 flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            disabled={downloading}
            className="h-11 cursor-pointer rounded-xl border border-black/10 px-5 text-sm font-semibold disabled:opacity-40"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => void downloadCertificate()}
            disabled={downloading}
            className="inline-flex h-11 cursor-pointer items-center gap-2 rounded-xl bg-[#252724] px-5 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50"
          >
            <Icon icon="solar:download-minimalistic-linear" width="18" />
            {downloading ? "Generating..." : "Download certificate"}
          </button>
        </div>
      </div>
    </div>
  );
}
