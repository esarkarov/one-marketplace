"use client";

import { Icon } from "@iconify/react";
import { useReverification, useSession, useUser } from "@clerk/nextjs";
import { errorMessage, isApiError } from "@onemarketplace/api-client";
import type {
  SessionWithActivitiesResource,
  TOTPResource,
} from "@clerk/shared/types";
import Link from "next/link";
import { useEffect, useState } from "react";
import { format } from "timeago.js";
import {
  useClientProfile,
  useSaveClientProfile,
  useStartIdentityVerification,
  useStripeManageLink,
} from "@/app/hooks/use-client-profile";
import {
  COMPANY_SIZE_OPTIONS,
  fieldErrorsFromApi,
  hasFieldErrors,
  INDUSTRY_OPTIONS,
  OTHER_INDUSTRY,
  profileToValues,
  resolveIndustry,
  splitIndustry,
  toProfileBody,
  validateProfileValues,
  type ClientProfile,
  type ClientProfileFieldErrors,
} from "@/lib/client-profile";

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

const navigation = [
  {
    id: "overview",
    label: "Overview",
    description: "Account summary",
    icon: "solar:widget-2-linear",
  },
  {
    id: "finances",
    label: "Finances",
    description: "Cards and billing details",
    icon: "solar:wallet-money-linear",
  },
  {
    id: "company",
    label: "Company profile",
    description: "Business information",
    icon: "solar:buildings-2-linear",
  },
  {
    id: "notifications",
    label: "Notifications",
    description: "Email and product alerts",
    icon: "solar:bell-linear",
  },
  {
    id: "verifications",
    label: "Verification",
    description: "Secure identity check by Stripe",
    icon: "solar:verified-check-linear",
  },
  {
    id: "account",
    label: "Password & security",
    description: "Password, 2FA, and devices",
    icon: "solar:shield-keyhole-linear",
  },
];

export function ClientSettings({
  initialSection,
  verificationActive,
}: {
  initialSection: string;
  verificationActive: boolean;
}) {
  const [notice, setNotice] = useState("");
  const [verificationOpened, setVerificationOpened] = useState(false);
  const [verificationDismissed, setVerificationDismissed] = useState(false);
  const { data: profileMetaData } = useClientProfile();

  const verificationOpen =
    verificationOpened ||
    (initialSection === "verifications" &&
      verificationActive &&
      profileMetaData?.identityVerified === false &&
      !verificationDismissed);

  const closeVerification = () => {
    setVerificationOpened(false);
    setVerificationDismissed(true);
  };

  const saveNotice = (message: string) => {
    setNotice(message);
    window.setTimeout(() => setNotice(""), 3000);
  };

  return (
    <>
      <div>
        <p className="text-xs font-semibold tracking-[.14em] text-[#62805f] uppercase">
          Client account
        </p>
        <h1 className="mt-2 text-3xl font-semibold tracking-[-.045em] sm:text-4xl">
          Settings
        </h1>
        <p className="mt-2 text-sm text-[#72776f]">
          Manage how your company hires, pays, and works on OneMarketplace.io.
        </p>
      </div>

      {notice && (
        <div
          role="status"
          className="mt-5 rounded-xl border border-[#cfe2ca] bg-[#edf5ea] px-4 py-3 text-xs font-semibold text-[#52784f]"
        >
          {notice}
        </div>
      )}

      <div className="mt-8 grid items-start gap-5 lg:grid-cols-[280px_minmax(0,1fr)]">
        <nav className="rounded-2xl border border-black/8 bg-white p-2 lg:sticky lg:top-24">
          {navigation.map((item) => {
            const active = item.id === initialSection;
            return (
              <Link
                key={item.id}
                href={`/settings?section=${item.id}`}
                className={`flex items-center gap-3 rounded-xl px-3 py-3 ${active ? "bg-[#edf4ea] text-[#4e774b]" : "hover:bg-[#f7f8f5]"}`}
              >
                <span
                  className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-xl ${active ? "bg-white" : "bg-[#f3f5f1]"}`}
                >
                  <Icon icon={item.icon} width="19" />
                </span>
                <span className="min-w-0 flex-1">
                  <strong className="block text-sm">{item.label}</strong>
                  <span className="mt-0.5 block truncate text-[10px] font-normal opacity-65">
                    {item.description}
                  </span>
                </span>
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
          {initialSection === "notifications" && (
            <NotificationSettings
              onSave={() => saveNotice("Notification preferences saved.")}
            />
          )}
          {initialSection === "verifications" && (
            <StripeVerification
              verified={profileMetaData?.identityVerified === true}
              onStart={() => setVerificationOpened(true)}
            />
          )}
          {initialSection === "account" && <AccountSettings />}
        </div>
      </div>

      {verificationOpen && (
        <IdentityVerificationModal onClose={closeVerification} />
      )}
    </>
  );
}

function SectionCard({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-2xl border border-black/8 bg-white p-5 sm:p-6">
      <h2 className="text-lg font-semibold">{title}</h2>
      {description && (
        <p className="mt-1.5 text-sm text-[#777d75]">{description}</p>
      )}
      <div className="mt-5">{children}</div>
    </section>
  );
}

function Overview({
  companyName,
  identityVerified,
}: {
  companyName?: string;
  identityVerified: boolean;
}) {
  const items = [
    {
      label: "Payment methods",
      value: "Cards & billing, managed in Stripe",
      href: "finances",
      icon: "solar:card-linear",
    },
    {
      label: "Company profile",
      value: companyName || "Not set yet",
      href: "company",
      icon: "solar:buildings-2-linear",
    },
    {
      label: "Identity verification",
      value: identityVerified ? "Verified" : "Not verified",
      href: "verifications",
      icon: "solar:verified-check-linear",
    },
    {
      label: "Password & security",
      value: "Password, 2FA, and devices",
      href: "account",
      icon: "solar:shield-keyhole-linear",
    },
  ];
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      {items.map((item) => (
        <Link
          key={item.label}
          href={`/settings?section=${item.href}`}
          className="rounded-2xl border border-black/8 bg-white p-5 hover:bg-[#fafbf9]"
        >
          <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-[#edf4ea] text-[#52784f]">
            <Icon icon={item.icon} width="20" />
          </span>
          <h2 className="mt-5 font-semibold">{item.label}</h2>
          <p className="mt-1 text-xs text-[#777d75]">{item.value}</p>
          <span className="mt-5 inline-flex items-center gap-1 text-xs font-semibold text-[#52784f]">
            Manage <Icon icon="solar:arrow-right-linear" width="13" />
          </span>
        </Link>
      ))}
    </div>
  );
}

function Finances({ onNotice }: { onNotice: (message: string) => void }) {
  const manageLink = useStripeManageLink();
  const redirecting = manageLink.isPending || manageLink.isSuccess;

  const manageFinances = async () => {
    try {
      const link = await manageLink.mutateAsync();
      window.location.assign(link.url);
    } catch (error) {
      onNotice(errorMessage(error));
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
            Update cards, billing details, and review every payment on your
            account.
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
  error,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  type?: string;
  error?: string | undefined;
}) {
  return (
    <label className="block">
      <span className="mb-2 block text-xs font-semibold">{label}</span>
      <input
        type={type}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        aria-invalid={Boolean(error)}
        className="h-11 w-full rounded-xl border border-black/10 px-3 text-sm outline-none focus:border-[#6f936b]"
      />
      {error && (
        <span role="alert" className="mt-1.5 block text-[11px] text-red-600">
          {error}
        </span>
      )}
    </label>
  );
}

function CompanySettings({
  profile,
  onSave,
}: {
  profile: ClientProfile | null | undefined;
  onSave: () => void;
}) {
  if (profile === undefined) return null;
  return <CompanyForm profile={profile} onSave={onSave} />;
}

function CompanyForm({
  profile,
  onSave,
}: {
  profile: ClientProfile | null;
  onSave: () => void;
}) {
  const saveProfile = useSaveClientProfile();
  const initial = profileToValues(profile);
  const initialIndustry = splitIndustry(initial.industry);
  const [error, setError] = useState("");
  const [fieldErrors, setFieldErrors] = useState<ClientProfileFieldErrors>({});
  const [companyName, setCompanyName] = useState(initial.companyName);
  const [companyWebsite, setCompanyWebsite] = useState(initial.companyWebsite);
  const [companySize, setCompanySize] = useState<string>(initial.companySize);
  const [industry, setIndustry] = useState<string>(initialIndustry.selected);
  const [customIndustry, setCustomIndustry] = useState(initialIndustry.custom);
  const [companyDescription, setCompanyDescription] = useState(
    initial.companyDescription,
  );

  const resolvedIndustry = resolveIndustry(industry, customIndustry);
  const isDirty =
    companyName.trim() !== initial.companyName ||
    companyWebsite.trim() !== initial.companyWebsite ||
    companySize.trim() !== initial.companySize ||
    companyDescription.trim() !== initial.companyDescription ||
    resolvedIndustry !== initial.industry;

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError("");
    setFieldErrors({});

    const values = {
      ...initial,
      companyName,
      companyWebsite,
      companySize,
      industry: resolvedIndustry,
      companyDescription,
    };
    const localErrors = validateProfileValues(values);

    if (hasFieldErrors(localErrors)) {
      setFieldErrors(localErrors);
      return;
    }

    try {
      await saveProfile.mutateAsync(toProfileBody(values));
      onSave();
    } catch (err) {
      if (isApiError(err)) setFieldErrors(fieldErrorsFromApi(err.errors));
      setError(
        isApiError(err) && err.requestId
          ? `${errorMessage(err)} (reference ${err.requestId})`
          : errorMessage(err),
      );
    }
  };

  return (
    <SectionCard
      title="Company profile"
      description="Information freelancers and agencies see when reviewing your opportunities."
    >
      <form onSubmit={(event) => void handleSubmit(event)}>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field
            label="Company name"
            value={companyName}
            onChange={setCompanyName}
            error={fieldErrors.companyName}
          />
          <Field
            label="Website"
            value={companyWebsite}
            onChange={setCompanyWebsite}
            error={fieldErrors.companyWebsite}
          />
          <label className="block">
            <span className="mb-2 block text-xs font-semibold">Industry</span>
            <select
              value={industry}
              onChange={(event) => setIndustry(event.target.value)}
              className="h-11 w-full rounded-xl border border-black/10 bg-white px-3 text-sm outline-none focus:border-[#6f936b]"
            >
              {[...INDUSTRY_OPTIONS, OTHER_INDUSTRY].map((option) => (
                <option key={option}>{option}</option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className="mb-2 block text-xs font-semibold">
              Company size
            </span>
            <select
              value={companySize}
              onChange={(event) => setCompanySize(event.target.value)}
              className="h-11 w-full rounded-xl border border-black/10 bg-white px-3 text-sm outline-none focus:border-[#6f936b]"
            >
              {COMPANY_SIZE_OPTIONS.map((option) => (
                <option key={option}>{option}</option>
              ))}
            </select>
          </label>
          {industry === OTHER_INDUSTRY && (
            <Field
              label="Custom industry"
              value={customIndustry}
              onChange={setCustomIndustry}
              error={fieldErrors.industry}
            />
          )}
        </div>
        <label className="mt-4 block">
          <span className="mb-2 block text-xs font-semibold">
            Company description
          </span>
          <textarea
            value={companyDescription}
            onChange={(event) => setCompanyDescription(event.target.value)}
            rows={5}
            className="w-full resize-none rounded-xl border border-black/10 p-3 text-sm outline-none focus:border-[#6f936b]"
          />
          {fieldErrors.companyDescription && (
            <span
              role="alert"
              className="mt-1.5 block text-[11px] text-red-600"
            >
              {fieldErrors.companyDescription}
            </span>
          )}
        </label>
        {error && (
          <p role="alert" className="mt-3 text-xs text-red-600">
            {error}
          </p>
        )}
        <button
          type="submit"
          disabled={saveProfile.isPending || !isDirty}
          className="mt-5 h-10 rounded-xl bg-[#252724] px-4 text-xs font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50"
        >
          {saveProfile.isPending ? "Saving..." : "Save company profile"}
        </button>
      </form>
    </SectionCard>
  );
}

function NotificationSettings({ onSave }: { onSave: () => void }) {
  return (
    <SectionCard
      title="Notification preferences"
      description="Choose the marketplace activity that should reach your inbox."
    >
      <div className="divide-y divide-black/7">
        {[
          "New proposals on my jobs",
          "Messages from talent",
          "Contract and milestone updates",
          "Payment and billing activity",
          "Product news and recommendations",
        ].map((label, index) => (
          <label
            key={label}
            className="flex items-center justify-between gap-4 py-4 first:pt-0"
          >
            <span className="text-sm">{label}</span>
            <input
              type="checkbox"
              defaultChecked={index < 4}
              className="h-4 w-4 accent-[#5d8759]"
            />
          </label>
        ))}
      </div>
      <button
        type="button"
        onClick={onSave}
        className="mt-3 h-10 rounded-xl bg-[#252724] px-4 text-xs font-semibold text-white"
      >
        Save preferences
      </button>
    </SectionCard>
  );
}

function StripeVerification({
  verified,
  onStart,
}: {
  verified: boolean;
  onStart: () => void;
}) {
  return (
    <SectionCard
      title="Identity verification"
      description="Identity checks are securely completed and processed by Stripe Identity."
    >
      <div className="flex flex-wrap items-center gap-4 rounded-xl border border-black/8 p-4">
        <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-[#edf4ea] text-[#52784f]">
          <Icon icon="solar:user-id-linear" width="22" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold">
            {verified ? "Identity verified" : "Verify your identity"}
          </p>
          <p className="mt-1 text-[10px] leading-5 text-[#7c8179]">
            {verified
              ? "Your identity verification is complete."
              : "Required while managing an active contract."}
          </p>
        </div>
        {verified ? (
          <span className="inline-flex h-10 items-center gap-2 rounded-xl bg-[#edf4ea] px-4 text-xs font-semibold text-[#52784f]">
            <Icon icon="solar:verified-check-bold" width="17" />
            Verification done
          </span>
        ) : (
          <button
            type="button"
            data-stripe-identity-trigger
            onClick={onStart}
            className="inline-flex h-10 items-center gap-2 rounded-xl bg-[#252724] px-4 text-xs font-semibold text-white"
          >
            <Icon icon="solar:shield-check-linear" width="17" />
            Verify with Stripe
          </button>
        )}
      </div>
      <div className="mt-5 flex gap-3 rounded-xl bg-[#f3f6f1] p-4 text-xs leading-5 text-[#667064]">
        <Icon
          icon="solar:lock-keyhole-linear"
          width="18"
          className="shrink-0 text-[#52784f]"
        />
        <p>
          OneMarketplace.io does not manually collect or review identity
          documents. Stripe securely handles the verification session and
          returns only its result.
        </p>
      </div>
    </SectionCard>
  );
}

function IdentityVerificationModal({ onClose }: { onClose: () => void }) {
  const session = useStartIdentityVerification();
  const redirecting = session.isPending || session.isSuccess;
  const [error, setError] = useState("");

  const startVerification = async () => {
    setError("");
    try {
      const result = await session.mutateAsync();
      window.location.assign(result.url);
    } catch (err) {
      setError(errorMessage(err));
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
