"use client";

import { Icon } from "@iconify/react";
import { useAuth, useReverification, useSession, useUser } from "@clerk/nextjs";
import type {
  SessionWithActivitiesResource,
  TOTPResource,
} from "@clerk/shared/types";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { useEffect, useState } from "react";
import { format } from "timeago.js";

const extractClerkError = (error: unknown): string => {
  if (error && typeof error === "object" && "errors" in error) {
    const errors = (
      error as { errors?: Array<{ longMessage?: string; message?: string }> }
    ).errors;
    if (errors?.[0]) {
      return (
        errors[0].longMessage || errors[0].message || "Something went wrong."
      );
    }
  }
  return error instanceof Error ? error.message : "Something went wrong.";
};

const inputClass =
  "mt-2 h-11 w-full rounded-xl border border-black/10 px-3 text-sm font-normal outline-none focus:border-[#6e916a]";

const Panel = ({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children: React.ReactNode;
}) => (
  <section className="overflow-hidden rounded-2xl border border-black/8 bg-white">
    <header className="border-b border-black/7 px-5 py-5 sm:px-6">
      <h2 className="text-lg font-semibold">{title}</h2>
      <p className="mt-1 text-xs text-[#7b8078]">{description}</p>
    </header>
    {children}
  </section>
);

interface ClientProfileMetadata {
  professionalRole?: string;
  companyName?: string;
  companyWebsite?: string;
  companySize?: string;
  industry?: string;
  companyDescription?: string;
  identityVerified?: boolean;
}

const navigation = [
  { id: "overview", label: "Overview", description: "Account summary", icon: "solar:widget-2-linear" },
  { id: "finances", label: "Finances", description: "Cards and billing details", icon: "solar:wallet-money-linear" },
  { id: "company", label: "Company profile", description: "Business information", icon: "solar:buildings-2-linear" },
  { id: "notifications", label: "Notifications", description: "Email and product alerts", icon: "solar:bell-linear" },
  { id: "verifications", label: "Verification", description: "Secure identity check by Stripe", icon: "solar:verified-check-linear" },
  { id: "account", label: "Password & security", description: "Password, 2FA, and devices", icon: "solar:shield-keyhole-linear" },
];

export function ClientSettings({
  initialSection,
  verificationActive,
}: {
  initialSection: string;
  verificationActive: boolean;
}) {
  const { getToken } = useAuth();
  const [notice, setNotice] = useState("");
  const [verificationOpen, setVerificationOpen] = useState(false);
  const { data: profileMetaData } = useQuery<ClientProfileMetadata>({
    queryKey: ["profile-metadata"],
    queryFn: async () => {
      const token = await getToken();
      const response = await fetch(
        `${process.env.NEXT_PUBLIC_SERVER_URI}/client/profile?role=client`,
        { headers: { Authorization: `Bearer ${token}` }, cache: "no-store" },
      );
      const result = await response.json();
      if (!response.ok) throw new Error(result.message);
      return result.data;
    },
  });

  useEffect(() => {
    if (
      initialSection === "verifications" &&
      verificationActive &&
      profileMetaData?.identityVerified === false
    ) {
      setVerificationOpen(true);
    }
  }, [initialSection, profileMetaData?.identityVerified, verificationActive]);

  const saveNotice = (message: string) => {
    setNotice(message);
    window.setTimeout(() => setNotice(""), 3000);
  };

  return (
    <>
      <div>
        <p className="text-xs font-semibold tracking-[.14em] text-[#62805f] uppercase">Client account</p>
        <h1 className="mt-2 text-3xl font-semibold tracking-[-.045em] sm:text-4xl">Settings</h1>
        <p className="mt-2 text-sm text-[#72776f]">Manage how your company hires, pays, and works on OneMarketplace.io.</p>
      </div>

      {notice && <div role="status" className="mt-5 rounded-xl border border-[#cfe2ca] bg-[#edf5ea] px-4 py-3 text-xs font-semibold text-[#52784f]">{notice}</div>}

      <div className="mt-8 grid items-start gap-5 lg:grid-cols-[280px_minmax(0,1fr)]">
        <nav className="rounded-2xl border border-black/8 bg-white p-2 lg:sticky lg:top-24">
          {navigation.map((item) => {
            const active = item.id === initialSection;
            return (
              <Link key={item.id} href={`/settings?section=${item.id}`} className={`flex items-center gap-3 rounded-xl px-3 py-3 ${active ? "bg-[#edf4ea] text-[#4e774b]" : "hover:bg-[#f7f8f5]"}`}>
                <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-xl ${active ? "bg-white" : "bg-[#f3f5f1]"}`}><Icon icon={item.icon} width="19" /></span>
                <span className="min-w-0 flex-1"><strong className="block text-sm">{item.label}</strong><span className="mt-0.5 block truncate text-[10px] font-normal opacity-65">{item.description}</span></span>
                <Icon icon="solar:alt-arrow-right-linear" width="14" />
              </Link>
            );
          })}
        </nav>

        <div className="min-w-0">
          {initialSection === "overview" && (
            <Overview
              companyName={profileMetaData?.companyName}
              identityVerified={profileMetaData?.identityVerified === true}
            />
          )}
          {initialSection === "finances" && <Finances onNotice={saveNotice} />}
          {initialSection === "company" && (
            <CompanySettings
              profile={profileMetaData}
              onSave={() => saveNotice("Company profile updated.")}
            />
          )}
          {initialSection === "notifications" && <NotificationSettings onSave={() => saveNotice("Notification preferences saved.")} />}
          {initialSection === "verifications" && (
            <StripeVerification
              verified={profileMetaData?.identityVerified === true}
              onStart={() => setVerificationOpen(true)}
            />
          )}
          {initialSection === "account" && <AccountSettings />}
        </div>
      </div>

      {verificationOpen && (
        <IdentityVerificationModal
          onClose={() => setVerificationOpen(false)}
        />
      )}
    </>
  );
}

function SectionCard({ title, description, children }: { title: string; description?: string; children: React.ReactNode }) {
  return <section className="rounded-2xl border border-black/8 bg-white p-5 sm:p-6"><h2 className="text-lg font-semibold">{title}</h2>{description && <p className="mt-1.5 text-sm text-[#777d75]">{description}</p>}<div className="mt-5">{children}</div></section>;
}

function Overview({
  companyName,
  identityVerified,
}: {
  companyName?: string;
  identityVerified: boolean;
}) {
  const items = [
    { label: "Payment methods", value: "Cards & billing, managed in Stripe", href: "finances", icon: "solar:card-linear" },
    { label: "Company profile", value: companyName || "Not set yet", href: "company", icon: "solar:buildings-2-linear" },
    { label: "Identity verification", value: identityVerified ? "Verified" : "Not verified", href: "verifications", icon: "solar:verified-check-linear" },
    { label: "Password & security", value: "Password, 2FA, and devices", href: "account", icon: "solar:shield-keyhole-linear" },
  ];
  return <div className="grid gap-4 sm:grid-cols-2">{items.map((item) => <Link key={item.label} href={`/settings?section=${item.href}`} className="rounded-2xl border border-black/8 bg-white p-5 hover:bg-[#fafbf9]"><span className="flex h-10 w-10 items-center justify-center rounded-xl bg-[#edf4ea] text-[#52784f]"><Icon icon={item.icon} width="20" /></span><h2 className="mt-5 font-semibold">{item.label}</h2><p className="mt-1 text-xs text-[#777d75]">{item.value}</p><span className="mt-5 inline-flex items-center gap-1 text-xs font-semibold text-[#52784f]">Manage <Icon icon="solar:arrow-right-linear" width="13" /></span></Link>)}</div>;
}

function Finances({ onNotice }: { onNotice: (message: string) => void }) {
  const { getToken } = useAuth();
  const [redirecting, setRedirecting] = useState(false);

  const manageFinances = async () => {
    setRedirecting(true);
    try {
      const token = await getToken();
      const response = await fetch(
        `${process.env.NEXT_PUBLIC_SERVER_URI}/client/finances/manage-link?role=client`,
        { headers: { Authorization: `Bearer ${token}` } },
      );
      const result = await response.json();
      if (!response.ok || !result.data?.url) {
        throw new Error(result.message || "Stripe could not be opened right now.");
      }
      window.location.assign(result.data.url);
    } catch (error) {
      onNotice(
        error instanceof Error ? error.message : "Stripe could not be opened right now.",
      );
      setRedirecting(false);
    }
  };

  return (
    <SectionCard
      title="Finances"
      description="Manage payment methods, billing details, and view your full spend history through Stripe."
    >
      <div className="flex flex-wrap items-center gap-4 rounded-xl border border-black/8 p-4">
        <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-[#edf4ea] text-[#52784f]">
          <Icon icon="solar:wallet-money-linear" width="22" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold">Manage in Stripe</p>
          <p className="mt-1 text-[11px] text-[#7c8179]">
            Update cards, billing details, and review every payment on your account.
          </p>
        </div>
        <button
          type="button"
          onClick={() => void manageFinances()}
          disabled={redirecting}
          className="inline-flex h-10 items-center gap-2 rounded-xl bg-[#252724] px-4 text-xs font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50"
        >
          <Icon icon="solar:arrow-right-up-linear" width="17" />
          {redirecting ? "Redirecting..." : "Manage finances"}
        </button>
      </div>
    </SectionCard>
  );
}

function Field({
  label,
  value,
  onChange,
  type = "text",
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  type?: string;
}) {
  return (
    <label className="block">
      <span className="mb-2 block text-xs font-semibold">{label}</span>
      <input
        type={type}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="h-11 w-full rounded-xl border border-black/10 px-3 text-sm outline-none focus:border-[#6f936b]"
      />
    </label>
  );
}

const industryOptions = [
  "Healthcare technology",
  "Software & technology",
  "Financial services",
  "Retail & e-commerce",
  "Education",
  "Media & entertainment",
  "Professional services",
  "Manufacturing",
  "Real estate",
  "Nonprofit",
] as const;

const companySizeOptions = [
  "Just me",
  "2–10 employees",
  "11–50 employees",
  "51–200 employees",
  "201–500 employees",
  "501–1,000 employees",
  "1,001–5,000 employees",
  "5,001+ employees",
] as const;

function CompanySettings({
  profile,
  onSave,
}: {
  profile?: ClientProfileMetadata;
  onSave: () => void;
}) {
  const { getToken } = useAuth();
  const queryClient = useQueryClient();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [hydrated, setHydrated] = useState(false);

  const [companyName, setCompanyName] = useState("");
  const [companyWebsite, setCompanyWebsite] = useState("");
  const [companySize, setCompanySize] = useState<string>(companySizeOptions[0]);
  const [industry, setIndustry] = useState<string>(industryOptions[0]);
  const [customIndustry, setCustomIndustry] = useState("");
  const [companyDescription, setCompanyDescription] = useState("");

  useEffect(() => {
    if (!profile || hydrated) return;
    setCompanyName(profile.companyName ?? "");
    setCompanyWebsite(profile.companyWebsite ?? "");
    setCompanySize(profile.companySize || companySizeOptions[0]);
    const savedIndustry = profile.industry ?? "";
    if (
      savedIndustry &&
      !industryOptions.some((option) => option === savedIndustry)
    ) {
      setIndustry("Other");
      setCustomIndustry(savedIndustry);
    } else {
      setIndustry(savedIndustry || industryOptions[0]);
    }
    setCompanyDescription(profile.companyDescription ?? "");
    setHydrated(true);
  }, [profile, hydrated]);

  const resolvedIndustry = industry === "Other" ? customIndustry : industry;
  const isDirty =
    hydrated &&
    (companyName.trim() !== (profile?.companyName ?? "") ||
      companyWebsite.trim() !== (profile?.companyWebsite ?? "") ||
      companySize.trim() !== (profile?.companySize ?? "") ||
      companyDescription.trim() !== (profile?.companyDescription ?? "") ||
      resolvedIndustry.trim() !== (profile?.industry ?? ""));

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError("");

    const payload = {
      professionalRole: profile?.professionalRole ?? "",
      companyName: companyName.trim(),
      companyWebsite: companyWebsite.trim(),
      companySize: companySize.trim(),
      industry: resolvedIndustry.trim(),
      companyDescription: companyDescription.trim(),
    };

    setSaving(true);
    try {
      const token = await getToken();
      const response = await fetch(
        `${process.env.NEXT_PUBLIC_SERVER_URI}/client/profile?role=client`,
        {
          method: "PUT",
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify(payload),
        },
      );
      const result = await response.json();
      if (!response.ok) {
        throw new Error(result.message || "The company profile could not be saved.");
      }
      queryClient.setQueryData(
        ["profile-metadata"],
        (current: ClientProfileMetadata | undefined) => ({
          ...current,
          ...payload,
        }),
      );
      onSave();
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "The company profile could not be saved.",
      );
    } finally {
      setSaving(false);
    }
  };

  return (
    <SectionCard
      title="Company profile"
      description="Information freelancers and agencies see when reviewing your opportunities."
    >
      <form onSubmit={(event) => void handleSubmit(event)}>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Company name" value={companyName} onChange={setCompanyName} />
          <Field label="Website" value={companyWebsite} onChange={setCompanyWebsite} />
          <label className="block">
            <span className="mb-2 block text-xs font-semibold">Industry</span>
            <select
              value={industry}
              onChange={(event) => setIndustry(event.target.value)}
              className="h-11 w-full rounded-xl border border-black/10 bg-white px-3 text-sm outline-none focus:border-[#6f936b]"
            >
              {[...industryOptions, "Other"].map((option) => (
                <option key={option}>{option}</option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className="mb-2 block text-xs font-semibold">Company size</span>
            <select
              value={companySize}
              onChange={(event) => setCompanySize(event.target.value)}
              className="h-11 w-full rounded-xl border border-black/10 bg-white px-3 text-sm outline-none focus:border-[#6f936b]"
            >
              {companySizeOptions.map((option) => (
                <option key={option}>{option}</option>
              ))}
            </select>
          </label>
          {industry === "Other" && (
            <Field
              label="Custom industry"
              value={customIndustry}
              onChange={setCustomIndustry}
            />
          )}
        </div>
        <label className="mt-4 block">
          <span className="mb-2 block text-xs font-semibold">Company description</span>
          <textarea
            value={companyDescription}
            onChange={(event) => setCompanyDescription(event.target.value)}
            rows={5}
            className="w-full resize-none rounded-xl border border-black/10 p-3 text-sm outline-none focus:border-[#6f936b]"
          />
        </label>
        {error && <p className="mt-3 text-xs text-red-600">{error}</p>}
        <button
          type="submit"
          disabled={saving || !isDirty}
          className="mt-5 h-10 rounded-xl bg-[#252724] px-4 text-xs font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50"
        >
          {saving ? "Saving..." : "Save company profile"}
        </button>
      </form>
    </SectionCard>
  );
}

function NotificationSettings({ onSave }: { onSave: () => void }) {
  return <SectionCard title="Notification preferences" description="Choose the marketplace activity that should reach your inbox."><div className="divide-y divide-black/7">{["New proposals on my jobs", "Messages from talent", "Contract and milestone updates", "Payment and billing activity", "Product news and recommendations"].map((label, index) => <label key={label} className="flex items-center justify-between gap-4 py-4 first:pt-0"><span className="text-sm">{label}</span><input type="checkbox" defaultChecked={index < 4} className="h-4 w-4 accent-[#5d8759]" /></label>)}</div><button type="button" onClick={onSave} className="mt-3 h-10 rounded-xl bg-[#252724] px-4 text-xs font-semibold text-white">Save preferences</button></SectionCard>;
}

function StripeVerification({
  verified,
  onStart,
}: {
  verified: boolean;
  onStart: () => void;
}) {
  return <SectionCard title="Identity verification" description="Identity checks are securely completed and processed by Stripe Identity.">
    <div className="flex flex-wrap items-center gap-4 rounded-xl border border-black/8 p-4">
      <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-[#edf4ea] text-[#52784f]"><Icon icon="solar:user-id-linear" width="22" /></span>
      <div className="min-w-0 flex-1"><p className="text-sm font-semibold">{verified ? "Identity verified" : "Verify your identity"}</p><p className="mt-1 text-[10px] leading-5 text-[#7c8179]">{verified ? "Your identity verification is complete." : "Required while managing an active contract."}</p></div>
      {verified ? (
        <span className="inline-flex h-10 items-center gap-2 rounded-xl bg-[#edf4ea] px-4 text-xs font-semibold text-[#52784f]"><Icon icon="solar:verified-check-bold" width="17" />Verification done</span>
      ) : (
        <button type="button" data-stripe-identity-trigger onClick={onStart} className="inline-flex h-10 items-center gap-2 rounded-xl bg-[#252724] px-4 text-xs font-semibold text-white"><Icon icon="solar:shield-check-linear" width="17" />Verify with Stripe</button>
      )}
    </div>
    <div className="mt-5 flex gap-3 rounded-xl bg-[#f3f6f1] p-4 text-xs leading-5 text-[#667064]"><Icon icon="solar:lock-keyhole-linear" width="18" className="shrink-0 text-[#52784f]" /><p>OneMarketplace.io does not manually collect or review identity documents. Stripe securely handles the verification session and returns only its result.</p></div>
  </SectionCard>;
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
        `${process.env.NEXT_PUBLIC_SERVER_URI}/identity/session?role=client`,
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
          <button type="button" onClick={onClose} disabled={redirecting} aria-label="Close verification modal">
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
          <button type="button" onClick={onClose} disabled={redirecting} className="h-10 rounded-xl border border-black/10 px-4 text-xs font-semibold disabled:opacity-40">
            Cancel
          </button>
          <button type="button" onClick={() => void startVerification()} disabled={redirecting} className="h-10 rounded-xl bg-[#252724] px-4 text-xs font-semibold text-white disabled:opacity-50">
            {redirecting ? "Redirecting..." : "Continue to verification"}
          </button>
        </div>
      </div>
    </div>
  );
}

function AccountSettings() {
  return (
    <div className="grid gap-5">
      <PasswordSection />
      <TwoFactorSection />
      <ActiveSessionsSection />
    </div>
  );
}

function PasswordSection() {
  const { user } = useUser();
  const updatePassword = useReverification(
    (params: {
      currentPassword?: string;
      newPassword: string;
      signOutOfOtherSessions: boolean;
    }) => user?.updatePassword(params),
  );
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [signOutOthers, setSignOutOthers] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState(false);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setError("");
    setSuccess(false);

    if (newPassword !== confirmPassword) {
      setError("New passwords do not match.");
      return;
    }

    setSaving(true);
    try {
      await updatePassword({
        currentPassword: user?.passwordEnabled ? currentPassword : undefined,
        newPassword,
        signOutOfOtherSessions: signOutOthers,
      });
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
      setSuccess(true);
    } catch (err) {
      setError(extractClerkError(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Panel
      title="Password"
      description={
        user?.passwordEnabled
          ? "Update the password you use to sign in."
          : "Set a password to sign in without a code or social login."
      }
    >
      <form
        onSubmit={(event) => void submit(event)}
        className="grid gap-4 p-5 sm:p-6"
      >
        {user?.passwordEnabled && (
          <label className="text-xs font-semibold">
            Current password
            <input
              required
              type="password"
              placeholder="********"
              autoComplete="current-password"
              value={currentPassword}
              onChange={(event) => setCurrentPassword(event.target.value)}
              className={inputClass}
            />
          </label>
        )}
        <div className="grid gap-4 sm:grid-cols-2">
          <label className="text-xs font-semibold">
            New password
            <input
              required
              type="password"
              placeholder="********"
              autoComplete="new-password"
              value={newPassword}
              onChange={(event) => setNewPassword(event.target.value)}
              className={inputClass}
            />
          </label>
          <label className="text-xs font-semibold">
            Confirm new password
            <input
              required
              type="password"
              placeholder="********"
              autoComplete="new-password"
              value={confirmPassword}
              onChange={(event) => setConfirmPassword(event.target.value)}
              className={inputClass}
            />
          </label>
        </div>
        <label className="flex cursor-pointer items-center gap-3 text-xs font-semibold text-[#686e66]">
          <input
            type="checkbox"
            checked={signOutOthers}
            onChange={(event) => setSignOutOthers(event.target.checked)}
            className="h-4 w-4 accent-[#5f875c]"
          />
          Sign out of all other devices
        </label>
        {error && <p className="text-xs text-red-600">{error}</p>}
        {success && (
          <p className="text-xs font-semibold text-[#4d784a]">
            Your password has been updated.
          </p>
        )}
        <div className="flex justify-end">
          <button
            type="submit"
            disabled={saving}
            className="h-11 cursor-pointer rounded-xl bg-[#252724] px-5 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50"
          >
            {saving
              ? "Saving..."
              : user?.passwordEnabled
                ? "Update password"
                : "Set password"}
          </button>
        </div>
      </form>
    </Panel>
  );
}

function TwoFactorSection() {
  const { user } = useUser();
  const createTOTP = useReverification(() => user?.createTOTP());
  const disableTOTP = useReverification(() => user?.disableTOTP());
  const [totp, setTotp] = useState<TOTPResource | null>(null);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const enabled = Boolean(user?.twoFactorEnabled);

  const startSetup = async () => {
    setError("");
    setBusy(true);
    try {
      const created = await createTOTP();
      setTotp(created ?? null);
    } catch (err) {
      setError(extractClerkError(err));
    } finally {
      setBusy(false);
    }
  };

  const cancelSetup = () => {
    setTotp(null);
    setCode("");
    setError("");
  };

  const verify = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      await user?.verifyTOTP({ code });
      await user?.reload();
      setTotp(null);
      setCode("");
    } catch (err) {
      setError(extractClerkError(err));
    } finally {
      setBusy(false);
    }
  };

  const disable = async () => {
    setBusy(true);
    setError("");
    try {
      await disableTOTP();
      await user?.reload();
    } catch (err) {
      setError(extractClerkError(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Panel
      title="Two-factor authentication"
      description="Add an extra layer of security using an authenticator app."
    >
      <div className="grid gap-4 p-5 sm:p-6">
        <div className="flex flex-col justify-between gap-4 rounded-2xl border border-black/8 bg-[#f8f9f6] p-5 sm:flex-row sm:items-center">
          <div className="flex items-center gap-4">
            <span
              className={`flex h-11 w-11 items-center justify-center rounded-xl bg-white ${enabled ? "text-[#52784f]" : "text-[#9a9f96]"}`}
            >
              <Icon icon="solar:shield-keyhole-linear" width="22" />
            </span>
            <div>
              <h3 className="text-sm font-semibold">
                {enabled
                  ? "Two-factor authentication is on"
                  : "Authenticator app"}
              </h3>
              <p className="mt-1 text-xs text-[#7b8078]">
                {enabled
                  ? "Codes from your authenticator app are required at sign-in."
                  : "Use an app like Google Authenticator or 1Password."}
              </p>
            </div>
          </div>
          {enabled ? (
            <button
              type="button"
              onClick={() => void disable()}
              disabled={busy}
              className="h-10 cursor-pointer rounded-xl border border-black/10 px-4 text-xs font-semibold disabled:cursor-not-allowed disabled:opacity-50"
            >
              Disable
            </button>
          ) : (
            !totp && (
              <button
                type="button"
                onClick={() => void startSetup()}
                disabled={busy}
                className="h-10 cursor-pointer rounded-xl bg-[#252724] px-4 text-xs font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50"
              >
                {busy ? "Starting..." : "Enable 2FA"}
              </button>
            )
          )}
        </div>

        {totp && (
          <form
            onSubmit={(event) => void verify(event)}
            className="grid gap-4 rounded-2xl border border-black/8 p-5"
          >
            <p className="text-xs leading-5 text-[#7b8078]">
              Scan this into your authenticator app, or enter the setup key
              manually, then confirm with the 6-digit code it generates.
            </p>
            {totp.uri && (
              <img
                src={`https://api.qrserver.com/v1/create-qr-code/?size=180x180&data=${encodeURIComponent(totp.uri)}`}
                alt="Authenticator QR code"
                width={180}
                height={180}
                className="rounded-xl border border-black/8"
              />
            )}
            {totp.secret && (
              <p className="rounded-xl bg-[#f3f5f1] px-3 py-2 font-mono text-xs break-all">
                {totp.secret}
              </p>
            )}
            <label className="text-xs font-semibold">
              Verification code
              <input
                required
                inputMode="numeric"
                autoComplete="one-time-code"
                value={code}
                onChange={(event) => setCode(event.target.value)}
                className={inputClass}
                placeholder="123456"
              />
            </label>
            {error && <p className="text-xs text-red-600">{error}</p>}
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={cancelSetup}
                className="h-10 cursor-pointer rounded-xl border border-black/10 px-4 text-xs font-semibold"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={busy}
                className="h-10 cursor-pointer rounded-xl bg-[#252724] px-4 text-xs font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50"
              >
                {busy ? "Verifying..." : "Verify & enable"}
              </button>
            </div>
          </form>
        )}
        {!totp && error && <p className="text-xs text-red-600">{error}</p>}
      </div>
    </Panel>
  );
}

const formatSessionDevice = (session: SessionWithActivitiesResource) => {
  const activity = session.latestActivity;
  const browser = activity?.browserName || "Unknown browser";
  const device = activity?.isMobile
    ? "Mobile"
    : activity?.deviceType || "Desktop";
  const place = [activity?.city, activity?.country].filter(Boolean).join(", ");
  return { browser, device, place };
};

function ActiveSessionsSection() {
  const { user } = useUser();
  const { session: currentSession } = useSession();
  const [sessions, setSessions] = useState<
    SessionWithActivitiesResource[] | null
  >(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  useEffect(() => {
    if (!user) return;
    user
      .getSessions()
      .then(setSessions)
      .catch(() => setSessions([]));
  }, [user]);

  const revoke = async (target: SessionWithActivitiesResource) => {
    setBusyId(target.id);
    try {
      await target.revoke();
      setSessions(
        (prev) => prev?.filter((item) => item.id !== target.id) ?? null,
      );
    } finally {
      setBusyId(null);
    }
  };

  return (
    <Panel
      title="Active devices"
      description="Devices currently signed in to your account."
    >
      {sessions === null ? (
        <div className="p-5 sm:p-6">
          <div className="h-14 animate-pulse rounded-xl bg-[#eef0ec]" />
        </div>
      ) : sessions.length === 0 ? (
        <p className="px-5 py-8 text-center text-sm text-[#858a82] sm:px-6">
          No active sessions found.
        </p>
      ) : (
        <div>
          {sessions.map((item, index) => {
            const { browser, device, place } = formatSessionDevice(item);
            const isCurrent = item.id === currentSession?.id;
            return (
              <div
                key={item.id}
                className={`flex items-center gap-4 px-5 py-4 sm:px-6 ${index ? "border-t border-black/6" : ""}`}
              >
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[#f3f5f1] text-[#52784f]">
                  <Icon
                    icon={
                      device === "Mobile"
                        ? "solar:smartphone-linear"
                        : "solar:laptop-linear"
                    }
                    width="17"
                  />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold">
                    {browser} · {device}
                    {isCurrent && (
                      <span className="ml-2 rounded-full bg-[#e7f2e4] px-2 py-0.5 text-[10px] font-semibold text-[#4d784a]">
                        This device
                      </span>
                    )}
                  </p>
                  <p className="mt-1 truncate text-xs text-[#858a82]">
                    {place || "Unknown location"} · Active{" "}
                    {format(item.lastActiveAt)}
                  </p>
                </div>
                {!isCurrent && (
                  <button
                    type="button"
                    onClick={() => void revoke(item)}
                    disabled={busyId === item.id}
                    className="cursor-pointer text-xs font-semibold text-red-600 hover:underline disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {busyId === item.id ? "Signing out..." : "Sign out"}
                  </button>
                )}
              </div>
            );
          })}
        </div>
      )}
    </Panel>
  );
}
