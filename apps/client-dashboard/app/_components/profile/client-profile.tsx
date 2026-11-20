"use client";

import { Icon } from "@iconify/react";
import Link from "next/link";
import { SubmitEvent, useCallback, useEffect, useRef, useState } from "react";
import { useAuth, useUser } from "@clerk/nextjs";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import Image from "next/image";
import { countries } from "@/utils/countries";
import { toast } from "sonner";
import { UserResource } from "@clerk/nextjs/types";

interface ClientHiringOverview {
  totalSpent: number;
  completedContracts: number;
  rating: number;
  openJobs: number;
  totalHires: number;
  hireRate: number;
  averageResponseDays: number | null;
}

interface ClientCompletedContract {
  id: string;
  title: string;
  talent: string;
  budget: number;
  completedAt: string | null;
  clientReview: { rating: number; text: string } | null;
  talentReview: { rating: number; text: string } | null;
}

const formatCompactCurrency = (value: number) =>
  `$${new Intl.NumberFormat("en-US", {
    notation: "compact",
    maximumFractionDigits: 1,
  }).format(value)}`;

const formatResponseTime = (days: number | null) => {
  if (days === null) return "No data yet";
  if (days < 1) return "Within 1 day";
  const rounded = Math.round(days);
  return `${rounded} day${rounded === 1 ? "" : "s"}`;
};

interface ClientProfilePayload {
  professionalRole: string;
  companyName: string;
  companyWebsite: string;
  companySize: string;
  industry: string;
  companyDescription: string;
  identityVerified?: boolean;
  paymentMethodVerified?: boolean;
  joinedAt?: Date;
}

interface SaveClientProfileResponse {
  success: boolean;
  message: string;
}

interface ClientProfileMetadataResponse extends SaveClientProfileResponse {
  data: ClientProfilePayload | null;
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

export function ClientProfile({ editing = false }: { editing?: boolean }) {
  const { user } = useUser();
  const { getToken } = useAuth();
  const queryClient = useQueryClient();
  const router = useRouter();
  const formRef = useRef<HTMLFormElement>(null);
  const [saved, setSaved] = useState(false);
  const [avatarUrl, setAvatarUrl] = useState("");
  const [avatarFile, setAvatarFile] = useState<File | null>(null);
  const [avatarError, setAvatarError] = useState("");
  const [formError, setFormError] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isFormComplete, setIsFormComplete] = useState(false);
  const [selectedIndustry, setSelectedIndustry] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [hasAttemptedSubmit, setHasAttemptedSubmit] = useState(false);

  const { data: profileMetaData, isLoading: profileMetaDataLoading } = useQuery(
    {
      queryKey: ["profile-metadata"],
      enabled: Boolean(user),
      queryFn: async () => {
        const token = await getToken();

        const response = await fetch(
          `${process.env.NEXT_PUBLIC_SERVER_URI}/client/profile?role=client`,
          {
            headers: {
              Authorization: `Bearer ${token}`,
            },
            cache: "no-store",
          },
        );

        const result = (await response.json()) as ClientProfileMetadataResponse;

        if (!response.ok) {
          throw new Error(
            result.message || "The client profile could not be loaded.",
          );
        }

        return result.data;
      },
    },
  );

  const isIdentityVerified = Boolean(profileMetaData?.identityVerified);

  const savedIndustry = profileMetaData?.industry;
  const industry =
    selectedIndustry ??
    (savedIndustry
      ? industryOptions.some((option) => option === savedIndustry)
        ? savedIndustry
        : "Other"
      : "Software & technology");

  const saveClientProfileMutation = useMutation({
    mutationFn: async (payload: ClientProfilePayload) => {
      const token = await getToken();

      if (!token) {
        throw new Error("Your session has expired. Please sign in again.");
      }

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
      const result = (await response.json()) as SaveClientProfileResponse;
      if (!response.ok) {
        throw new Error(
          result.message || "The client profile could not be saved.",
        );
      }

      return result;
    },
    onSuccess: (_result, payload) => {
      queryClient.setQueryData(["profile-metadata"], payload);
    },
  });

  const getFieldErrorMessage = (
    field: HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement,
  ): string => {
    if (field.validity.valueMissing) return "This field is required.";
    if (field.validity.typeMismatch) {
      return field.type === "url"
        ? "Enter a full URL, like https://example.com."
        : "Enter a valid value.";
    }
    if (field.validity.tooShort && "minLength" in field) {
      return `Enter at least ${field.minLength} characters.`;
    }
    return "";
  };

  const validateForm = useCallback(() => {
    const form = formRef.current;

    if (!form) return false;

    const requiredFields = Array.from(
      form.querySelectorAll<
        HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement
      >("[required]"),
    );
    const errors: Record<string, string> = {};
    requiredFields.forEach((field) => {
      const message = getFieldErrorMessage(field);
      if (message) errors[field.name] = message;
    });
    setFieldErrors(errors);
    const hasAllRequiredValues = requiredFields.every(
      (field) => field.value.trim().length > 0,
    );
    const hasAvatar = Boolean(avatarFile || user?.hasImage);
    const isComplete =
      form.checkValidity() && hasAllRequiredValues && hasAvatar;
    setIsFormComplete(isComplete);
    return isComplete;
  }, [avatarFile, user?.hasImage]);

  useEffect(() => {
    validateForm();
  }, [industry, validateForm]);

  useEffect(
    () => () => {
      if (avatarUrl) URL.revokeObjectURL(avatarUrl);
    },
    [avatarUrl],
  );

  const handleAvatarChange = (file?: File) => {
    setSaved(false);
    setAvatarError("");

    if (!file) return;

    const allowedTypes = ["image/jpeg", "image/png", "image/webp"];

    if (!allowedTypes.includes(file.type)) {
      setAvatarFile(null);
      setAvatarUrl("");
      setAvatarError("Choose a JPG, PNG, or WebP image.");
      return;
    }

    if (file.size > 5 * 1024 * 1024) {
      setAvatarFile(null);
      setAvatarUrl("");
      setAvatarError("Profile photos must be 5 MB or smaller.");
      return;
    }

    setAvatarFile(file);
    setAvatarUrl(URL.createObjectURL(file));
  };

  const handleSubmit = async (event: SubmitEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSaved(false);
    setFormError("");

    if (!user) {
      setFormError("Your authenticated user could not be loaded.");
      return;
    }

    setHasAttemptedSubmit(true);

    if (!validateForm()) {
      setFormError(
        user?.hasImage || avatarFile
          ? "Complete every required profile field before saving."
          : "Add a profile photo and complete every required field before saving.",
      );
      return;
    }

    const formData = new FormData(event.currentTarget);
    const firstName = isIdentityVerified
      ? (user.firstName ?? "")
      : String(formData.get("firstName") ?? "").trim();
    const lastName = isIdentityVerified
      ? (user.lastName ?? "")
      : String(formData.get("lastName") ?? "").trim();
    const location = isIdentityVerified
      ? String(user.unsafeMetadata?.country ?? "")
      : String(formData.get("location") ?? "").trim();
    const selectedIndustry = String(formData.get("industry") ?? "").trim();
    const customIndustry = String(formData.get("customIndustry") ?? "").trim();
    const profilePayload: ClientProfilePayload = {
      professionalRole: String(formData.get("jobRole") ?? "").trim(),
      companyName: String(formData.get("companyName") ?? "").trim(),
      companyWebsite: String(formData.get("companyWebsite") ?? "").trim(),
      companySize: String(formData.get("companySize") ?? "").trim(),
      industry:
        selectedIndustry === "Other" ? customIndustry : selectedIndustry,
      companyDescription: String(
        formData.get("companyDescription") ?? "",
      ).trim(),
    };

    setIsSubmitting(true);

    try {
      if (avatarFile) {
        await user.setProfileImage({ file: avatarFile });
      }

      await user.update({
        firstName,
        lastName,
        unsafeMetadata: {
          ...user.unsafeMetadata,
          country: location,
        },
      });

      await saveClientProfileMutation.mutateAsync(profilePayload);

      setSaved(true);
      toast.success("Account updated successfully!");
      window.location.assign("/profile");
    } catch (error) {
      console.error("Client profile update failed.", error);
      setFormError(
        error instanceof Error
          ? error.message
          : "We could not save your profile. Please try again.",
      );
    } finally {
      setIsSubmitting(false);
    }
  };

  if (!user || profileMetaDataLoading) {
    return <ProfileSkeleton editing={editing} />;
  }

  return (
    <>
      <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
        <div>
          <p className="text-xs font-semibold tracking-[.14em] text-[#62805f] uppercase">
            Client account
          </p>
          <h1 className="mt-2 text-3xl font-semibold tracking-[-.045em] sm:text-4xl">
            {editing ? "Edit profile" : "My profile"}
          </h1>
          <p className="mt-2 text-sm text-[#72776f]">
            {editing
              ? "Update the information talent sees on your jobs and contracts."
              : "Preview the client identity freelancers and agencies see."}
          </p>
        </div>
        <Link
          href={editing ? "/profile" : "/profile/edit"}
          className={`inline-flex h-11 cursor-pointer items-center justify-center gap-2 rounded-xl px-5 text-sm font-semibold ${
            editing
              ? "border border-black/10 bg-white"
              : "bg-[#252724] text-white"
          }`}
        >
          <Icon
            icon={editing ? "solar:eye-linear" : "solar:pen-2-linear"}
            width="18"
          />
          {editing ? "Preview profile" : "Edit profile"}
        </Link>
      </div>

      {saved && (
        <p
          role="status"
          className="mt-5 rounded-xl bg-[#e7f2e4] p-3 text-xs font-semibold text-[#4d784a]"
        >
          Client profile changes saved.
        </p>
      )}

      {editing ? (
        <form
          onSubmit={handleSubmit}
          ref={formRef}
          onInput={() => {
            setSaved(false);
            validateForm();
          }}
          className="mt-8 grid gap-5"
        >
          <section className="rounded-2xl border border-black/8 bg-white p-5 sm:p-6">
            <h2 className="font-semibold">Profile identity</h2>
            <p className="mt-1 text-xs text-[#7b8078]">
              Your photo and personal details identify the owner of the client
              account.
            </p>
            <div className="mt-5 flex flex-col gap-4 rounded-xl bg-[#f4f6f2] p-4 sm:flex-row sm:items-center">
              <Image
                src={avatarUrl || user.imageUrl}
                width={90}
                height={90}
                alt="Client avatar preview"
                className="h-20 w-20 rounded-full object-cover"
              />
              <div>
                <h3 className="text-sm font-semibold">Profile photo</h3>
                <p className="mt-1 text-xs text-[#7b8078]">
                  Upload a square JPG, PNG, or WebP image.
                </p>
                <label className="mt-3 inline-flex h-9 cursor-pointer items-center gap-2 rounded-lg border border-black/10 bg-white px-3 text-xs font-semibold">
                  <Icon icon="solar:camera-linear" width="17" />
                  Change photo
                  <input
                    type="file"
                    accept="image/png,image/jpeg,image/webp"
                    className="sr-only"
                    onChange={(event) => {
                      handleAvatarChange(event.target.files?.[0]);
                    }}
                  />
                </label>
                <p className="inline-flex pl-2 items-center gap-1.5 text-xs text-[#6f756d]">
                  <Icon
                    icon="solar:shield-check-linear"
                    width="15"
                    className="shrink-0 text-[#5b8658]"
                  />
                  Please use your real photo to avoid unnecessary account
                  restrictions.
                </p>
              </div>
              {avatarError && (
                <p className="mt-2 text-xs font-medium text-[#a34f49]">
                  {avatarError}
                </p>
              )}
            </div>
            {isIdentityVerified && (
              <div className="mt-5 flex items-center gap-2 rounded-xl border border-[#d2dfcf] bg-[#edf4ea] px-4 py-3 text-xs text-[#476f44]">
                <Icon icon="solar:lock-keyhole-bold" width="16" />
                Your name and location are locked because your identity is
                verified.
              </div>
            )}
            <div className="mt-5 grid gap-4 sm:grid-cols-2">
              <Field
                label="First name *"
                name="firstName"
                defaultValue={user.firstName || "N/A"}
                placeholder="First name"
                disabled={isIdentityVerified}
                error={hasAttemptedSubmit ? fieldErrors.firstName : undefined}
              />
              <Field
                label="Last name *"
                name="lastName"
                defaultValue={user.lastName || "N/A"}
                placeholder="Last name"
                disabled={isIdentityVerified}
                error={hasAttemptedSubmit ? fieldErrors.lastName : undefined}
              />
              <Field
                label="Role *"
                name="jobRole"
                defaultValue={profileMetaData?.professionalRole ?? ""}
                placeholder="Managing Director"
                error={hasAttemptedSubmit ? fieldErrors.jobRole : undefined}
              />
              <label className="text-xs font-semibold">
                Location *
                <select
                  name="location"
                  required
                  disabled={isIdentityVerified}
                  defaultValue={(() => {
                    const savedCountry = user?.unsafeMetadata?.country;

                    if (typeof savedCountry !== "string") return "";

                    return (
                      countries.find(
                        (country) =>
                          country.code === savedCountry ||
                          country.name === savedCountry,
                      )?.code ?? ""
                    );
                  })()}
                  className={`mt-2 h-11 w-full rounded-xl border bg-white px-3 text-sm font-normal outline-none disabled:cursor-not-allowed disabled:bg-black/3 disabled:text-[#8a8f87] ${
                    hasAttemptedSubmit && fieldErrors.location
                      ? "border-[#cf827c] focus:border-[#cf827c]"
                      : "border-black/10 focus:border-[#6e916a]"
                  }`}
                >
                  <option value="" disabled>
                    Select your country
                  </option>
                  {countries.map((country) => (
                    <option value={country.code} key={country.code}>
                      {country.name}
                    </option>
                  ))}
                </select>
                {hasAttemptedSubmit && fieldErrors.location && (
                  <span
                    role="alert"
                    className="mt-1.5 block text-[11px] font-medium text-[#a34f49]"
                  >
                    {fieldErrors.location}
                  </span>
                )}
              </label>
            </div>
          </section>

          <section className="rounded-2xl border border-black/8 bg-white p-5 sm:p-6">
            <h2 className="font-semibold">Company information</h2>
            <p className="mt-1 text-xs text-[#7b8078]">
              This information is attached to public job posts and proposals.
            </p>
            <div className="mt-5 grid gap-4 sm:grid-cols-2">
              <Field
                label="Company name *"
                name="companyName"
                defaultValue={profileMetaData?.companyName ?? ""}
                placeholder="Acme Ltd."
                error={hasAttemptedSubmit ? fieldErrors.companyName : undefined}
              />
              <Field
                label="Company website *"
                name="companyWebsite"
                type="url"
                error={
                  hasAttemptedSubmit ? fieldErrors.companyWebsite : undefined
                }
                defaultValue={profileMetaData?.companyWebsite ?? ""}
                placeholder="https://xyz.com"
              />
              <SelectField
                label="Company size *"
                name="companySize"
                defaultValue={profileMetaData?.companySize ?? "Just me"}
                options={[
                  "Just me",
                  "2–10 employees",
                  "11–50 employees",
                  "51–200 employees",
                  "201–500 employees",
                  "501–1,000 employees",
                  "1,001–5,000 employees",
                  "5,001+ employees",
                ]}
              />
              <label className="text-xs font-semibold">
                Industry *
                <select
                  name="industry"
                  required
                  value={industry}
                  onChange={(event) => setSelectedIndustry(event.target.value)}
                  className="mt-2 h-11 w-full rounded-xl border border-black/10 bg-white px-3 text-sm font-normal outline-none focus:border-[#6e916a]"
                >
                  {[...industryOptions, "Other"].map((option) => (
                    <option key={option}>{option}</option>
                  ))}
                </select>
              </label>
              {industry === "Other" && (
                <Field
                  label="Custom industry *"
                  name="customIndustry"
                  defaultValue={
                    profileMetaData &&
                    !industryOptions.some(
                      (option) => option === profileMetaData.industry,
                    )
                      ? profileMetaData.industry
                      : ""
                  }
                  placeholder="Enter your industry"
                  error={
                    hasAttemptedSubmit ? fieldErrors.customIndustry : undefined
                  }
                />
              )}
            </div>
            <label className="mt-4 block text-xs font-semibold">
              Company description *
              <textarea
                name="companyDescription"
                rows={5}
                required
                defaultValue={profileMetaData?.companyDescription ?? ""}
                placeholder="company description"
                aria-invalid={Boolean(
                  hasAttemptedSubmit && fieldErrors.companyDescription,
                )}
                className={`mt-2 w-full resize-none rounded-xl border p-3 text-sm font-normal outline-none ${
                  hasAttemptedSubmit && fieldErrors.companyDescription
                    ? "border-[#cf827c] focus:border-[#cf827c]"
                    : "border-black/10 focus:border-[#6e916a]"
                }`}
              />
              {hasAttemptedSubmit && fieldErrors.companyDescription && (
                <span
                  role="alert"
                  className="mt-1.5 block text-[11px] font-medium text-[#a34f49]"
                >
                  {fieldErrors.companyDescription}
                </span>
              )}
            </label>
          </section>

          {formError && (
            <p role="alert" className="text-sm font-medium text-[#a34f49]">
              {formError}
            </p>
          )}

          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={() => router.push("/profile")}
              className="h-11 rounded-xl border border-black/10 bg-white px-5 text-sm font-semibold"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={
                !isFormComplete ||
                isSubmitting ||
                saveClientProfileMutation.isPending
              }
              className="h-11 rounded-xl bg-[#252724] px-5 text-sm font-semibold text-white disabled:opacity-40"
            >
              {isSubmitting ? "Saving..." : "Save profile"}
            </button>
          </div>
        </form>
      ) : (
        <ProfilePreview profileMetadata={profileMetaData} user={user} />
      )}
    </>
  );
}

function ProfilePreview({
  profileMetadata,
  user,
}: {
  profileMetadata: ClientProfilePayload | null | undefined;
  user: UserResource;
}) {
  const { getToken } = useAuth();
  const contractsPerPage = 2;
  const [contractPage, setContractPage] = useState(1);

  const { data: hiringOverview } = useQuery({
    queryKey: ["client-hiring-overview"],
    queryFn: async () => {
      const token = await getToken();

      const response = await fetch(
        `${process.env.NEXT_PUBLIC_SERVER_URI}/client/hiring-overview?role=client`,
        {
          headers: { Authorization: `Bearer ${token}` },
          cache: "no-store",
        },
      );

      const result = await response.json();

      if (!response.ok) {
        throw new Error(
          result.message || "Hiring activity could not be loaded.",
        );
      }

      return result.data as ClientHiringOverview;
    },
  });

  const { data: completedContracts, isLoading: completedContractsLoading } =
    useQuery({
      queryKey: ["client-completed-contracts"],
      queryFn: async () => {
        const token = await getToken();

        const response = await fetch(
          `${process.env.NEXT_PUBLIC_SERVER_URI}/client/completed-contracts?role=client`,
          {
            headers: { Authorization: `Bearer ${token}` },
            cache: "no-store",
          },
        );

        const result = await response.json();

        if (!response.ok) {
          throw new Error(
            result.message || "Completed contracts could not be loaded.",
          );
        }

        return result.data as ClientCompletedContract[];
      },
    });

  const contracts = completedContracts ?? [];
  const totalContractPages = Math.max(
    Math.ceil(contracts.length / contractsPerPage),
    1,
  );
  const contractStart = (contractPage - 1) * contractsPerPage;
  const visibleContracts = contracts.slice(
    contractStart,
    contractStart + contractsPerPage,
  );

  const openContractPage = (page: number) => {
    setContractPage(Math.min(Math.max(page, 1), totalContractPages));
  };

  return (
    <div className="mt-8 grid items-start gap-6 lg:grid-cols-[300px_minmax(0,1fr)]">
      <aside className="grid gap-4 lg:sticky lg:top-24">
        <section className="rounded-2xl border border-black/8 bg-white p-6 text-center">
          <Image
            src={user?.imageUrl || ""}
            width={90}
            height={90}
            alt="Olivia Bennett"
            className="mx-auto h-28 w-28 rounded-full object-cover"
          />
          <h2 className="mt-5 inline-flex items-center justify-center gap-1.5 text-xl font-semibold">
            {user?.fullName}
            {profileMetadata?.identityVerified && (
              <Icon
                icon="solar:verified-check-bold"
                width="19"
                className="text-[#5b8658]"
              />
            )}
          </h2>
          <p className="mt-1 text-sm text-[#747a72]">
            {profileMetadata?.professionalRole} · {profileMetadata?.companyName}
          </p>
          <div className="mt-3 flex justify-center text-xs text-[#858a82]">
            <span className="inline-flex max-w-56 items-start gap-1.5 text-center">
              <Icon
                icon="solar:map-point-linear"
                width="16"
                className="mt-px shrink-0"
              />
              <span>
                {countries.find(
                  (country) => country.code === user?.unsafeMetadata.country,
                )?.name ?? ""}
              </span>
            </span>
          </div>
          <div className="mt-5 border-t border-black/7 pt-5">
            {profileMetadata?.paymentMethodVerified ? (
              <span className="inline-flex items-center gap-2 rounded-full bg-[#e8f3e5] px-3 py-2 text-xs font-semibold text-[#4d784a]">
                <Icon icon="solar:verified-check-bold" width="17" />
                Payment method verified
              </span>
            ) : (
              <div className="flex flex-col items-center gap-2.5">
                <p className="inline-flex items-center gap-1.5 text-xs font-semibold text-[#a34f49]">
                  <Icon icon="solar:danger-triangle-linear" width="16" />
                  Payment method not verified
                </p>
                <Link
                  href="/settings?section=finances"
                  className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-[#d8aaa6] bg-[#fff8f7] px-3 text-xs font-semibold text-[#914a45] transition hover:bg-[#fcecea]"
                >
                  Add payment method
                  <Icon icon="solar:arrow-right-linear" width="14" />
                </Link>
              </div>
            )}
          </div>
        </section>

        <section className="rounded-2xl border border-black/8 bg-white p-5">
          <h2 className="text-sm font-semibold">Hiring activity</h2>
          <dl className="mt-4 grid gap-4">
            <SidebarDetail
              label="Open jobs"
              value={hiringOverview ? String(hiringOverview.openJobs) : "..."}
            />
            <SidebarDetail
              label="Total hires"
              value={hiringOverview ? String(hiringOverview.totalHires) : "..."}
            />
            <SidebarDetail
              label="Hire rate"
              value={hiringOverview ? `${hiringOverview.hireRate}%` : "..."}
            />
            <SidebarDetail
              label="Average response"
              value={
                hiringOverview
                  ? formatResponseTime(hiringOverview.averageResponseDays)
                  : "..."
              }
            />
          </dl>
        </section>

        <section className="rounded-2xl border border-black/8 bg-white p-5">
          <h2 className="text-sm font-semibold">Company details</h2>
          <dl className="mt-4 grid gap-4">
            <SidebarDetail
              label="Industry"
              value={profileMetadata?.industry || "N/A"}
            />
            <SidebarDetail
              label="Company size"
              value={profileMetadata?.companyName || "Just me"}
            />
            <SidebarDetail
              label="Member since"
              value={
                profileMetadata?.joinedAt?.toString().slice(0, 4) || "2026"
              }
            />
          </dl>
          <a
            href={profileMetadata?.companyWebsite}
            target="_blank"
            rel="noreferrer"
            className="mt-5 inline-flex items-center gap-1.5 text-xs font-semibold text-[#52784f] hover:underline"
          >
            {profileMetadata?.companyWebsite}
            <Icon icon="solar:arrow-right-up-linear" width="14" />
          </a>
        </section>
      </aside>

      <div className="grid gap-6">
        <section className="rounded-2xl border border-black/8 bg-white p-6 sm:p-8">
          <p className="text-xs font-semibold tracking-[.13em] text-[#62805f] uppercase">
            About the company
          </p>
          <h2 className="mt-3 text-2xl font-semibold">
            {profileMetadata?.companyName}
          </h2>
          <p className="mt-4 max-w-3xl text-sm leading-7 text-[#676e66]">
            {profileMetadata?.companyDescription}
          </p>
          <div className="mt-6 grid gap-3 sm:grid-cols-3">
            <Info label="Industry" value={profileMetadata?.industry || "N/A"} />
            <Info
              label="Company size"
              value={profileMetadata?.companyName || "Just me"}
            />
            <Info
              label="Member since"
              value={
                profileMetadata?.joinedAt?.toString().slice(0, 4) || "2026"
              }
            />
          </div>
        </section>
        <section className="grid gap-4 sm:grid-cols-3">
          <InfoCard
            value={
              hiringOverview
                ? formatCompactCurrency(hiringOverview.totalSpent)
                : "..."
            }
            label="Total spent"
          />
          <InfoCard
            value={
              hiringOverview ? String(hiringOverview.completedContracts) : "..."
            }
            label="Contracts completed"
          />
          <InfoCard
            value={
              hiringOverview
                ? hiringOverview.rating > 0
                  ? hiringOverview.rating.toFixed(1)
                  : "No ratings yet"
                : "..."
            }
            label="Client rating"
          />
        </section>
        <section className="overflow-hidden rounded-2xl border border-black/8 bg-white">
          <header className="border-b border-black/7 p-5 sm:p-6">
            <p className="text-[10px] font-semibold tracking-[.13em] text-[#62805f] uppercase">
              Work history
            </p>
            <div className="mt-2 flex flex-wrap items-end justify-between gap-3">
              <div>
                <h2 className="text-xl font-semibold">Completed contracts</h2>
                <p className="mt-1 text-xs text-[#7b8078]">
                  Contract outcomes and feedback shared by both sides.
                </p>
              </div>
              <p className="text-xs text-[#8a8f87]">
                {contracts.length} completed contracts
              </p>
            </div>
          </header>
          {completedContractsLoading ? (
            <div className="divide-y divide-black/7">
              {[0, 1].map((item) => (
                <div key={item} className="animate-pulse p-5 sm:p-6">
                  <div className="h-4 w-52 rounded-full bg-[#e4e7e1]" />
                  <div className="mt-2 h-3 w-32 rounded-full bg-[#eef0ec]" />
                  <div className="mt-5 grid gap-3 lg:grid-cols-2">
                    <div className="h-20 rounded-xl bg-[#f4f6f2]" />
                    <div className="h-20 rounded-xl bg-[#f4f6f2]" />
                  </div>
                </div>
              ))}
            </div>
          ) : contracts.length === 0 ? (
            <p className="px-5 py-10 text-center text-sm text-[#858a82] sm:px-6">
              No completed contracts yet.
            </p>
          ) : (
            <div className="divide-y divide-black/7">
              {visibleContracts.map((contract) => (
                <article key={contract.id} className="p-5 sm:p-6">
                  <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-start">
                    <div>
                      <h3 className="text-base font-semibold">
                        {contract.title}
                      </h3>
                      <p className="mt-1 text-xs text-[#737970]">
                        {contract.talent}
                      </p>
                    </div>
                    <div className="text-left sm:text-right">
                      <p className="text-sm font-semibold">
                        ${contract.budget.toLocaleString()}
                      </p>
                      <p className="mt-1 text-[10px] text-[#8a8f87]">
                        {contract.completedAt
                          ? `Completed ${new Date(
                              contract.completedAt,
                            ).toLocaleDateString("en-US", {
                              month: "long",
                              day: "numeric",
                              year: "numeric",
                            })}`
                          : "Completed"}
                      </p>
                    </div>
                  </div>

                  <div className="mt-5 grid gap-3 lg:grid-cols-2">
                    <ReviewCard
                      label={`${user?.firstName ?? "Your"} review of ${contract.talent}`}
                      review={contract.clientReview ?? undefined}
                    />
                    <ReviewCard
                      label={`${contract.talent}’s review of you`}
                      review={contract.talentReview ?? undefined}
                    />
                  </div>
                </article>
              ))}
            </div>
          )}
          {contracts.length > 0 && (
            <footer className="flex flex-col gap-3 border-t border-black/7 bg-[#fafbf9] p-4 sm:flex-row sm:items-center sm:justify-between sm:px-6">
              <p className="text-xs text-[#858a82]">
                Showing {contractStart + 1}–
                {Math.min(contractStart + contractsPerPage, contracts.length)}{" "}
                of {contracts.length} contracts
              </p>
              <div className="flex flex-wrap items-center gap-2">
                {contractPage > 1 && (
                  <button
                    type="button"
                    onClick={() => openContractPage(contractPage - 1)}
                    className="inline-flex h-10 cursor-pointer items-center gap-1.5 rounded-xl border border-black/10 bg-white px-3 text-xs font-semibold hover:bg-[#f6f8f4]"
                  >
                    <Icon icon="solar:alt-arrow-left-linear" width="15" />
                    Previous
                  </button>
                )}
                <div className="flex items-center gap-1">
                  {Array.from(
                    { length: totalContractPages },
                    (_, index) => index + 1,
                  ).map((pageNumber) => (
                    <button
                      key={pageNumber}
                      type="button"
                      aria-label={`Open contract history page ${pageNumber}`}
                      aria-current={
                        contractPage === pageNumber ? "page" : undefined
                      }
                      onClick={() => openContractPage(pageNumber)}
                      className={`flex h-9 w-9 cursor-pointer items-center justify-center rounded-lg text-xs font-semibold ${
                        contractPage === pageNumber
                          ? "bg-[#edf4ea] text-[#4e774b]"
                          : "hover:bg-black/4"
                      }`}
                    >
                      {pageNumber}
                    </button>
                  ))}
                </div>
                {contractPage < totalContractPages && (
                  <button
                    type="button"
                    onClick={() => openContractPage(contractPage + 1)}
                    className="inline-flex h-10 cursor-pointer items-center gap-1.5 rounded-xl bg-[#252724] px-4 text-xs font-semibold text-white"
                  >
                    See more contracts
                    <Icon icon="solar:alt-arrow-right-linear" width="15" />
                  </button>
                )}
              </div>
            </footer>
          )}
        </section>
      </div>
    </div>
  );
}

function Field({
  label,
  name,
  defaultValue,
  type = "text",
  placeholder,
  disabled = false,
  error,
}: {
  label: string;
  name: string;
  defaultValue: string;
  type?: string;
  placeholder?: string;
  disabled?: boolean;
  error?: string;
}) {
  return (
    <label className="text-xs font-semibold">
      {label}
      <input
        name={name}
        required
        type={type}
        defaultValue={defaultValue}
        placeholder={placeholder}
        disabled={disabled}
        aria-invalid={Boolean(error)}
        className={`mt-2 h-11 w-full rounded-xl border px-3 text-sm font-normal outline-none disabled:cursor-not-allowed disabled:bg-black/3 disabled:text-[#8a8f87] ${
          error
            ? "border-[#cf827c] focus:border-[#cf827c]"
            : "border-black/10 focus:border-[#6e916a]"
        }`}
      />
      {error && (
        <span
          role="alert"
          className="mt-1.5 block text-[11px] font-medium text-[#a34f49]"
        >
          {error}
        </span>
      )}
    </label>
  );
}

function ProfileSkeleton({ editing }: { editing: boolean }) {
  return (
    <div
      role="status"
      aria-live="polite"
      aria-label="Loading profile information"
      className="animate-pulse"
    >
      <header className="flex items-end justify-between gap-4">
        <div>
          <div className="h-3 w-28 rounded-full bg-[#dfe5dc]" />
          <div className="mt-3 h-9 w-48 rounded-lg bg-[#e3e8e0]" />
          <div className="mt-3 h-4 w-72 max-w-[70vw] rounded-full bg-[#e9ede7]" />
        </div>
        <div className="hidden h-11 w-36 rounded-xl bg-[#e3e8e0] sm:block" />
      </header>

      {editing ? (
        <div className="mt-8 grid gap-5">
          <EditSectionSkeleton includeAvatar />
          <EditSectionSkeleton />
        </div>
      ) : (
        <div className="mt-8 grid items-start gap-6 lg:grid-cols-[300px_minmax(0,1fr)]">
          <aside className="grid gap-4">
            <section className="rounded-2xl border border-black/6 bg-white p-6">
              <div className="mx-auto h-28 w-28 rounded-full bg-[#dce4d9]" />
              <div className="mx-auto mt-5 h-6 w-40 rounded-md bg-[#dfe5dc]" />
              <div className="mx-auto mt-3 h-3 w-48 rounded-full bg-[#e9ede7]" />
              <div className="mx-auto mt-3 h-3 w-32 rounded-full bg-[#e9ede7]" />
              <div className="mt-5 border-t border-black/6 pt-5">
                <div className="mx-auto h-8 w-44 rounded-full bg-[#e4ebe1]" />
              </div>
            </section>
            <section className="rounded-2xl border border-black/6 bg-white p-5">
              <div className="h-4 w-28 rounded bg-[#dfe5dc]" />
              <div className="mt-5 grid gap-4">
                {[0, 1, 2, 3].map((item) => (
                  <div key={item} className="flex justify-between gap-5">
                    <div className="h-3 w-20 rounded-full bg-[#e9ede7]" />
                    <div className="h-3 w-14 rounded-full bg-[#dfe5dc]" />
                  </div>
                ))}
              </div>
            </section>
          </aside>

          <main className="grid gap-6">
            <section className="rounded-2xl border border-black/6 bg-white p-6 sm:p-8">
              <div className="h-3 w-28 rounded-full bg-[#dfe5dc]" />
              <div className="mt-4 h-7 w-64 rounded-lg bg-[#dfe5dc]" />
              <div className="mt-5 h-3 w-full rounded-full bg-[#e9ede7]" />
              <div className="mt-3 h-3 w-4/5 rounded-full bg-[#e9ede7]" />
              <div className="mt-7 grid gap-3 sm:grid-cols-3">
                {[0, 1, 2].map((item) => (
                  <div key={item} className="h-16 rounded-xl bg-[#f0f3ee]" />
                ))}
              </div>
            </section>
            <section className="grid gap-4 sm:grid-cols-3">
              {[0, 1, 2].map((item) => (
                <div
                  key={item}
                  className="h-24 rounded-2xl border border-black/6 bg-white p-5"
                >
                  <div className="h-6 w-20 rounded bg-[#dfe5dc]" />
                  <div className="mt-3 h-3 w-28 rounded-full bg-[#e9ede7]" />
                </div>
              ))}
            </section>
            <section className="h-72 rounded-2xl border border-black/6 bg-white p-6">
              <div className="h-5 w-44 rounded bg-[#dfe5dc]" />
              <div className="mt-3 h-3 w-64 rounded-full bg-[#e9ede7]" />
              <div className="mt-8 h-28 rounded-xl bg-[#f0f3ee]" />
            </section>
          </main>
        </div>
      )}
      <span className="sr-only">Loading profile information</span>
    </div>
  );
}

function EditSectionSkeleton({
  includeAvatar = false,
}: {
  includeAvatar?: boolean;
}) {
  return (
    <section className="rounded-2xl border border-black/6 bg-white p-5 sm:p-6">
      <div className="h-5 w-40 rounded-md bg-[#dfe5dc]" />
      <div className="mt-2 h-3 w-72 max-w-full rounded-full bg-[#e9ede7]" />
      {includeAvatar && (
        <div className="mt-5 flex items-center gap-4 rounded-xl bg-[#f4f6f2] p-4">
          <div className="h-20 w-20 shrink-0 rounded-full bg-[#dce4d9]" />
          <div className="w-full max-w-sm">
            <div className="h-4 w-28 rounded bg-[#dfe5dc]" />
            <div className="mt-2 h-3 w-52 rounded-full bg-[#e5eae2]" />
            <div className="mt-3 h-9 w-28 rounded-lg bg-white" />
          </div>
        </div>
      )}
      <div className="mt-5 grid gap-4 sm:grid-cols-2">
        {[0, 1, 2, 3].map((item) => (
          <div key={item}>
            <div className="h-3 w-20 rounded-full bg-[#dfe5dc]" />
            <div className="mt-2 h-11 rounded-xl bg-[#f0f3ee]" />
          </div>
        ))}
      </div>
      {!includeAvatar && <div className="mt-4 h-28 rounded-xl bg-[#f0f3ee]" />}
    </section>
  );
}

function SelectField({
  label,
  name,
  defaultValue,
  options,
}: {
  label: string;
  name: string;
  defaultValue: string;
  options: string[];
}) {
  return (
    <label className="text-xs font-semibold">
      {label}
      <select
        name={name}
        defaultValue={defaultValue}
        className="mt-2 h-11 w-full rounded-xl border border-black/10 bg-white px-3 text-sm font-normal outline-none focus:border-[#6e916a]"
      >
        {options.map((option) => (
          <option key={option}>{option}</option>
        ))}
      </select>
    </label>
  );
}

function Info({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl bg-[#f3f5f1] p-4">
      <p className="text-[10px] text-[#858a82]">{label}</p>
      <p className="mt-1 text-xs font-semibold">{value}</p>
    </div>
  );
}

function InfoCard({ value, label }: { value: string; label: string }) {
  return (
    <article className="rounded-2xl border border-black/8 bg-white p-5">
      <p className="text-2xl font-semibold">{value}</p>
      <p className="mt-1 text-xs text-[#7b8078]">{label}</p>
    </article>
  );
}

function SidebarDetail({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-start justify-between gap-4 text-xs">
      <dt className="text-[#898e86]">{label}</dt>
      <dd className="text-right font-semibold text-[#414640]">{value}</dd>
    </div>
  );
}

function ReviewCard({
  label,
  review,
}: {
  label: string;
  review?: { rating: number; text: string };
}) {
  return (
    <div className="rounded-xl bg-[#f4f6f2] p-4">
      <p className="text-[10px] font-semibold text-[#71776f]">{label}</p>
      {review ? (
        <>
          <p className="mt-2 flex items-center gap-1 text-xs font-semibold">
            <Icon
              icon="solar:star-bold"
              width="15"
              className="text-[#d4a934]"
            />
            {review.rating.toFixed(1)}
          </p>
          <p className="mt-2 text-xs leading-6 text-[#656b64]">
            “{review.text}”
          </p>
        </>
      ) : (
        <p className="mt-3 text-xs text-[#969a93]">No review available.</p>
      )}
    </div>
  );
}
