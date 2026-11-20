"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { DashboardHeader } from "../_components/dashboard/dashboard-header";
import { WorkspaceSidebar } from "../_components/dashboard/workspace-sidebar";
import { EarningsStatementModal } from "../_components/settings/earnings-statement-modal";
import { FinanceModal } from "../_components/settings/finance-modal";
import { FinanceOverview } from "../_components/settings/finance-overview";
import { type SettingsSectionId } from "../_components/settings/settings-data";
import { SettingsNavigation } from "../_components/settings/settings-navigation";
import {
  AccountPanel,
  AgencyPanel,
  ConnectsPanel,
  EarningsPanel,
  IdentityVerificationPanel,
  WithdrawalPanel,
} from "../_components/settings/settings-panels";
import { useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@clerk/nextjs";
import { Icon } from "@iconify/react";

const validSections: SettingsSectionId[] = [
  "overview",
  "connects",
  "earnings",
  "withdrawal",
  "agency",
  "verification",
  "security",
  "notifications",
];

export function SettingsDashboard({
  initialSection,
  paymentStatus,
  verificationActive,
}: {
  initialSection?: string;
  paymentStatus?: string;
  verificationActive?: boolean;
}) {
  const [section, setSection] = useState<SettingsSectionId>(
    validSections.includes(initialSection as SettingsSectionId)
      ? (initialSection as SettingsSectionId)
      : "overview",
  );
  const [modal, setModal] = useState<"connects" | null>(null);
  const [statementOpen, setStatementOpen] = useState(false);
  const [verificationOpen, setVerificationOpen] = useState(
    initialSection === "verification" && verificationActive,
  );
  const router = useRouter();
  const queryClient = useQueryClient();

  useEffect(() => {
    if (paymentStatus !== "success") return;

    void Promise.all([
      queryClient.invalidateQueries({ queryKey: ["connects"] }),
      queryClient.invalidateQueries({ queryKey: ["connects-history"] }),
    ]);
  }, [paymentStatus, queryClient]);

  const openSection = (nextSection: SettingsSectionId) => {
    setSection(nextSection);
    router.push(`/settings?section=${nextSection}`, { scroll: false });
  };

  return (
    <div className="min-h-svh bg-[#f4f6f2] font-(family-name:--font-dm-sans) text-[#242724]">
      <DashboardHeader />
      <main className="mx-auto max-w-360 px-5 py-8 sm:px-8 lg:py-10">
        <div className="grid items-start gap-6 xl:grid-cols-[240px_minmax(0,1fr)]">
          <WorkspaceSidebar />
          <div className="min-w-0">
            <div>
              <p className="text-xs font-semibold tracking-[0.14em] text-[#62805f] uppercase">
                Account center
              </p>
              <h1 className="mt-2 text-3xl font-semibold tracking-[-0.045em] sm:text-4xl">
                Settings
              </h1>
              <p className="mt-2 text-sm text-[#72776f]">
                Manage your finances, account preferences, security, and
                marketplace activity.
              </p>
            </div>

            <div className="mt-8 grid items-start gap-5 lg:grid-cols-[235px_minmax(0,1fr)]">
              <div className="lg:sticky lg:top-24">
                <SettingsNavigation active={section} onChange={openSection} />
              </div>
              <div className="min-w-0">
                {section === "overview" && (
                  <FinanceOverview
                    onOpenSection={openSection}
                    onBuyConnects={() => setModal("connects")}
                    onWithdraw={() => openSection("withdrawal")}
                    onDownloadStatement={() => setStatementOpen(true)}
                  />
                )}
                {section === "connects" && (
                  <ConnectsPanel onBuy={() => setModal("connects")} />
                )}
                {section === "earnings" && (
                  <EarningsPanel
                    onWithdraw={() => openSection("withdrawal")}
                    onDownloadStatement={() => setStatementOpen(true)}
                  />
                )}
                {section === "withdrawal" && <WithdrawalPanel />}
                {section === "agency" && <AgencyPanel />}
                {section === "verification" && (
                  <IdentityVerificationPanel
                    onStart={() => setVerificationOpen(true)}
                  />
                )}
                {["security", "notifications"].includes(section) && (
                  <AccountPanel kind={section as "security" | "notifications"} />
                )}
              </div>
            </div>
          </div>
        </div>
      </main>
      {modal && <FinanceModal onClose={() => setModal(null)} />}
      {statementOpen && (
        <EarningsStatementModal onClose={() => setStatementOpen(false)} />
      )}
      {verificationOpen && (
        <IdentityVerificationModal
          onClose={() => setVerificationOpen(false)}
        />
      )}
    </div>
  );
}

function IdentityVerificationModal({ onClose }: { onClose: () => void }) {
  const { getToken } = useAuth();
  const [redirecting, setRedirecting] = useState(false);
  const [error, setError] = useState("");

  const startVerification = async () => {
    setRedirecting(true);
    setError("");
    try {
      const token = await getToken();
      const response = await fetch(
        `${process.env.NEXT_PUBLIC_SERVER_URI}/identity/session?role=freelancer`,
        {
          method: "POST",
          headers: { Authorization: `Bearer ${token}` },
        },
      );
      const result = await response.json();
      if (!response.ok || !result.data?.url) {
        throw new Error(result.message || "Verification could not start.");
      }
      window.location.assign(result.data.url);
    } catch (error) {
      setError(
        error instanceof Error ? error.message : "Verification could not start.",
      );
      setRedirecting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-90 grid place-items-center bg-[#172018]/45 p-5 backdrop-blur-sm">
      <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-2xl">
        <div className="flex items-start justify-between gap-4">
          <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-[#edf4ea] text-[#52784f]">
            <Icon icon="solar:user-id-linear" width="23" />
          </span>
          <button
            type="button"
            onClick={onClose}
            disabled={redirecting}
            aria-label="Close verification modal"
          >
            <Icon icon="solar:close-circle-linear" width="23" />
          </button>
        </div>
        <h2 className="mt-4 text-xl font-semibold">Verify your identity</h2>
        <p className="mt-2 text-sm leading-6 text-[#737970]">
          You’ll be redirected to Stripe to securely verify your identity.
          OneMarketplace does not store your identity document.
        </p>
        {error && <p className="mt-4 text-xs text-red-600">{error}</p>}
        <div className="mt-6 flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            disabled={redirecting}
            className="h-10 rounded-xl border border-black/10 px-4 text-xs font-semibold disabled:opacity-40"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => void startVerification()}
            disabled={redirecting}
            className="h-10 rounded-xl bg-[#252724] px-4 text-xs font-semibold text-white disabled:opacity-50"
          >
            {redirecting ? "Redirecting..." : "Continue to verification"}
          </button>
        </div>
      </div>
    </div>
  );
}
