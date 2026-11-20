"use client";

import { Icon } from "@iconify/react";
import { useAuth } from "@clerk/nextjs";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import type { AgencySettingsSectionId } from "./settings-data";

interface AgencyImage {
  imageId: string;
  url: string;
}

interface AgencyPortfolioItem {
  id: string;
  title: string;
  category: string;
  description: string;
  liveUrl: string | null;
  coverImage: AgencyImage;
}

interface AgencyMemberSummary {
  id: string;
  freelancerId: string;
  name: string;
  avatarUrl: string | null;
  role: string;
  isOwner: boolean;
}

interface AgencyProfileData {
  id: string;
  name: string;
  professionalTitle: string | null;
  size: string;
  specialty: string;
  website: string | null;
  overview: string;
  tags: string[];
  avatarImage: AgencyImage | null;
  isOnboarded: boolean;
  portfolio: AgencyPortfolioItem[];
}

function Panel({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children: React.ReactNode;
}) {
  return (
    <section className="overflow-hidden rounded-2xl border border-black/8 bg-white">
      <header className="border-b border-black/7 px-5 py-5 sm:px-6">
        <h2 className="text-lg font-semibold">{title}</h2>
        <p className="mt-1 text-xs text-[#7b8078]">{description}</p>
      </header>
      {children}
    </section>
  );
}

function SavedNotice({ message }: { message: string }) {
  return (
    <p
      role="status"
      className="rounded-xl bg-[#eaf3e7] px-4 py-3 text-xs font-medium text-[#4e774b]"
    >
      {message}
    </p>
  );
}

export function OverviewPanel({
  onOpenSection,
}: {
  onOpenSection: (section: AgencySettingsSectionId) => void;
}) {
  const { getToken } = useAuth();

  const { data: agency } = useQuery({
    queryKey: ["agency-mine"],
    queryFn: async () => {
      const token = await getToken();
      const response = await fetch(
        `${process.env.NEXT_PUBLIC_SERVER_URI}/agency/mine?role=freelancer`,
        { headers: { Authorization: `Bearer ${token}` }, cache: "no-store" },
      );
      const result = await response.json();
      if (!response.ok) throw new Error(result.message);
      return result.data as { members: AgencyMemberSummary[] } | null;
    },
  });

  const { data: verification } = useQuery({
    queryKey: ["agency-verification"],
    queryFn: async () => {
      const token = await getToken();
      const response = await fetch(
        `${process.env.NEXT_PUBLIC_SERVER_URI}/agency/verification?role=freelancer`,
        { headers: { Authorization: `Bearer ${token}` }, cache: "no-store" },
      );
      const result = await response.json();
      if (!response.ok) throw new Error(result.message);
      return result.data as { identityVerified: boolean; isOwner: boolean };
    },
  });

  const memberCount = agency?.members.length ?? 0;

  const items = [
    {
      title: "Members & access",
      detail: agency
        ? `${memberCount} active agency member${memberCount === 1 ? "" : "s"}`
        : "Loading...",
      section: "members" as const,
      icon: "solar:users-group-rounded-linear",
    },
    {
      title: "Identity verification",
      detail: verification
        ? verification.identityVerified
          ? "Agency owner verified through Stripe"
          : "Agency owner not verified yet"
        : "Loading...",
      section: "verification" as const,
      icon: "solar:verified-check-linear",
    },
    {
      title: "Notifications",
      detail: "How agency activity reaches the team",
      section: "notifications" as const,
      icon: "solar:bell-linear",
    },
  ];

  return (
    <Panel
      title="Agency settings overview"
      description="Review the essentials for your agency account."
    >
      <div className="grid gap-3 p-5 sm:grid-cols-2 sm:p-6">
        {items.map((item) => (
          <button
            key={item.title}
            type="button"
            onClick={() => onOpenSection(item.section)}
            className="flex cursor-pointer items-center gap-4 rounded-xl border border-black/7 p-4 text-left transition hover:bg-[#f8f9f6]"
          >
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[#edf4ea] text-[#52784f]">
              <Icon icon={item.icon} width="20" />
            </span>
            <span className="min-w-0 flex-1">
              <strong className="block text-sm">{item.title}</strong>
              <span className="mt-1 block text-xs text-[#7b8078]">
                {item.detail}
              </span>
            </span>
            <Icon
              icon="solar:alt-arrow-right-linear"
              width="16"
              className="text-[#858a82]"
            />
          </button>
        ))}
      </div>
      <div className="border-t border-black/7 px-5 py-4 text-xs text-[#737870] sm:px-6">
        Financial settings and Connects are managed from the{" "}
        <a
          href="/finances?section=overview"
          className="font-semibold text-[#52784f] hover:underline"
        >
          Finances page
        </a>
        .
      </div>
    </Panel>
  );
}

const readFileAsDataUrl = (file: File) =>
  new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });

interface PortfolioFormItem {
  id: string;
  title: string;
  category: string;
  description: string;
  link: string;
  coverUrl: string;
  coverImageId?: string;
}

const buildSnapshot = (fields: {
  name: string;
  website: string;
  professionalTitle: string;
  specialty: string;
  size: string;
  overview: string;
  tags: string[];
  avatarUrl: string;
  portfolio: PortfolioFormItem[];
}) =>
  JSON.stringify({
    ...fields,
    portfolio: fields.portfolio.map(
      ({ title, category, description, link, coverUrl }) => ({
        title,
        category,
        description,
        link,
        coverUrl,
      }),
    ),
  });

export function ProfilePanel() {
  const { getToken } = useAuth();
  const queryClient = useQueryClient();
  const [saved, setSaved] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [name, setName] = useState("");
  const [website, setWebsite] = useState("");
  const [professionalTitle, setProfessionalTitle] = useState("");
  const [specialty, setSpecialty] = useState("");
  const [size, setSize] = useState("");
  const [overview, setOverview] = useState("");
  const [avatarUrl, setAvatarUrl] = useState("");
  const [avatarImageId, setAvatarImageId] = useState<string | undefined>(
    undefined,
  );
  const [agencyTags, setAgencyTags] = useState("");
  const [hydrated, setHydrated] = useState(false);
  const [snapshot, setSnapshot] = useState("");
  const [portfolio, setPortfolio] = useState<PortfolioFormItem[]>([]);

  const tagList = agencyTags
    .split(",")
    .map((tag) => tag.trim())
    .filter(Boolean);
  const hasAvatar = Boolean(avatarUrl);
  const hasEnoughTags = tagList.length >= 5;
  const hasPortfolioItem =
    portfolio.length > 0 &&
    portfolio.every(
      (item) =>
        item.title.trim() &&
        item.category.trim() &&
        item.description.trim() &&
        item.coverUrl,
    );
  const isComplete = hasAvatar && hasEnoughTags && hasPortfolioItem;
  const isDirty =
    hydrated &&
    snapshot !==
      buildSnapshot({
        name,
        website,
        professionalTitle,
        specialty,
        size,
        overview,
        tags: tagList,
        avatarUrl,
        portfolio,
      });

  const { data: agency, isLoading } = useQuery({
    queryKey: ["agency-mine"],
    queryFn: async () => {
      const token = await getToken();

      const response = await fetch(
        `${process.env.NEXT_PUBLIC_SERVER_URI}/agency/mine?role=freelancer`,
        {
          headers: { Authorization: `Bearer ${token}` },
          cache: "no-store",
        },
      );

      const result = await response.json();

      if (!response.ok) {
        throw new Error(
          result.message || "The agency profile could not be loaded.",
        );
      }

      return result.data as AgencyProfileData | null;
    },
  });

  useEffect(() => {
    if (!agency || hydrated) return;

    const loadedName = agency.name;
    const loadedWebsite = agency.website ?? "";
    const loadedProfessionalTitle = agency.professionalTitle ?? "";
    const loadedSpecialty = agency.specialty;
    const loadedSize = agency.size;
    const loadedOverview = agency.overview;
    const loadedTags = agency.tags.join(", ");
    const loadedAvatarUrl = agency.avatarImage?.url ?? "";
    const loadedPortfolio: PortfolioFormItem[] = agency.portfolio.map(
      (item) => ({
        id: item.id,
        title: item.title,
        category: item.category,
        description: item.description,
        link: item.liveUrl ?? "",
        coverUrl: item.coverImage.url,
        coverImageId: item.coverImage.imageId,
      }),
    );

    void Promise.resolve().then(() => {
      setName(loadedName);
      setWebsite(loadedWebsite);
      setProfessionalTitle(loadedProfessionalTitle);
      setSpecialty(loadedSpecialty);
      setSize(loadedSize);
      setOverview(loadedOverview);
      setAgencyTags(loadedTags);
      if (agency.avatarImage) {
        setAvatarUrl(agency.avatarImage.url);
        setAvatarImageId(agency.avatarImage.imageId);
      }
      setPortfolio(loadedPortfolio);
      setSnapshot(
        buildSnapshot({
          name: loadedName,
          website: loadedWebsite,
          professionalTitle: loadedProfessionalTitle,
          specialty: loadedSpecialty,
          size: loadedSize,
          overview: loadedOverview,
          tags: agency.tags,
          avatarUrl: loadedAvatarUrl,
          portfolio: loadedPortfolio,
        }),
      );
      setHydrated(true);
    });
  }, [agency, hydrated]);

  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSaved(false);
    setError("");

    if (!isComplete || !isDirty) return;

    const payload = {
      name: name.trim(),
      professionalTitle: professionalTitle.trim(),
      specialty: specialty.trim(),
      size: size.trim(),
      website: website.trim(),
      overview: overview.trim(),
      tags: tagList,
      avatarImage: avatarUrl
        ? { url: avatarUrl, imageId: avatarImageId }
        : undefined,
      portfolio: portfolio.map((item) => ({
        title: item.title,
        category: item.category,
        description: item.description,
        liveUrl: item.link || undefined,
        coverImage: { url: item.coverUrl, imageId: item.coverImageId },
      })),
    };

    setSaving(true);
    try {
      const token = await getToken();
      const response = await fetch(
        `${process.env.NEXT_PUBLIC_SERVER_URI}/agency?role=freelancer`,
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
        throw new Error(
          result.message || "The agency profile could not be saved.",
        );
      }

      await queryClient.invalidateQueries({ queryKey: ["agency-mine"] });
      setSaved(true);
      window.location.assign("/profile");
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "The agency profile could not be saved.",
      );
    } finally {
      setSaving(false);
    }
  };

  if (isLoading) {
    return (
      <Panel
        title="Agency profile"
        description="Manage the identity, positioning, and work clients see on your public profile."
      >
        <div className="p-5 sm:p-6">
          <div className="h-32 animate-pulse rounded-xl bg-[#eef0ec]" />
        </div>
      </Panel>
    );
  }

  return (
    <Panel
      title="Agency profile"
      description="Manage the identity, positioning, and work clients see on your public profile."
    >
      <form
        key={agency ? "loaded" : "loading"}
        onSubmit={(event) => void submit(event)}
        className="grid gap-5 p-5 sm:p-6"
      >
        {saved && <SavedNotice message="Agency profile changes saved." />}
        <section className="flex flex-col gap-4 rounded-xl bg-[#f4f6f2] p-4 sm:flex-row sm:items-center">
          {avatarUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={avatarUrl}
              alt="Agency avatar preview"
              className="h-20 w-20 rounded-2xl object-cover"
            />
          ) : (
            <span className="flex h-20 w-20 shrink-0 items-center justify-center rounded-2xl bg-[#496e67] text-xl font-semibold text-white">
              ND
            </span>
          )}
          <div className="min-w-0">
            <h3 className="text-sm font-semibold">Agency avatar</h3>
            <p
              className={`mt-1 text-xs leading-5 ${hasAvatar ? "text-[#7b8078]" : "text-[#a4453d]"}`}
            >
              {hasAvatar
                ? "Upload a square JPG, PNG, or WebP image. Recommended size: 400 × 400px."
                : "Required — upload a square JPG, PNG, or WebP image. Recommended size: 400 × 400px."}
            </p>
            <label className="mt-3 inline-flex h-9 cursor-pointer items-center gap-2 rounded-lg border border-black/10 bg-white px-3 text-xs font-semibold">
              <Icon icon="solar:camera-linear" width="17" />
              Change avatar
              <input
                type="file"
                accept="image/png,image/jpeg,image/webp"
                className="sr-only"
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  if (!file) return;
                  void readFileAsDataUrl(file).then((dataUrl) => {
                    setAvatarUrl(dataUrl);
                    setAvatarImageId(undefined);
                  });
                }}
              />
            </label>
          </div>
        </section>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Agency name" value={name} onChange={setName} />
          <Field
            label="Website"
            value={website}
            onChange={setWebsite}
            type="url"
          />
        </div>
        <Field
          label="Profile title"
          value={professionalTitle}
          onChange={setProfessionalTitle}
        />
        <div className="grid gap-4 sm:grid-cols-2">
          <SelectField
            label="Primary specialty"
            value={specialty}
            onChange={setSpecialty}
            options={[
              "Web & software development",
              "Design & creative",
              "Data & AI",
              "Marketing",
            ]}
          />
          <SelectField
            label="Agency size"
            value={size}
            onChange={setSize}
            options={[
              "2–5 members",
              "6–10 members",
              "11–25 members",
              "26+ members",
            ]}
          />
        </div>
        <label className="text-xs font-semibold">
          Profile description
          <textarea
            required
            rows={6}
            value={overview}
            onChange={(event) => setOverview(event.target.value)}
            className="mt-2 w-full resize-none rounded-xl border border-black/10 p-3 text-sm font-normal outline-none focus:border-[#6e916a]"
          />
        </label>
        <section>
          <label className="text-xs font-semibold">
            Agency tags
            <input
              value={agencyTags}
              onChange={(event) => setAgencyTags(event.target.value)}
              placeholder="Next.js, Product design, TypeScript"
              className="mt-2 h-11 w-full rounded-xl border border-black/10 px-3 text-sm font-normal outline-none focus:border-[#6e916a]"
            />
          </label>
          <p
            className={`mt-2 text-[10px] ${hasEnoughTags ? "text-[#8b9088]" : "text-[#a4453d]"}`}
          >
            Separate tags with commas. Add at least 5 tags ({tagList.length}/5)
            — these appear on your public profile and help clients discover your
            agency.
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            {tagList.map((tag) => (
              <span
                key={tag}
                className="rounded-full bg-[#edf3ea] px-3 py-1.5 text-[10px] font-medium text-[#527052]"
              >
                {tag}
              </span>
            ))}
          </div>
        </section>
        <section className="border-t border-black/7 pt-5">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h3 className="text-sm font-semibold">Portfolio</h3>
              <p
                className={`mt-1 text-xs ${hasPortfolioItem ? "text-[#7b8078]" : "text-[#a4453d]"}`}
              >
                {hasPortfolioItem
                  ? "Showcase the strongest work completed by your agency."
                  : "Required — add at least 1 project to showcase your agency's work."}
              </p>
            </div>
            <button
              type="button"
              onClick={() =>
                setPortfolio((current) => [
                  ...current,
                  {
                    id: crypto.randomUUID(),
                    title: "Untitled agency project",
                    category: "Add project category",
                    description: "",
                    link: "",
                    coverUrl: "",
                    coverImageId: undefined,
                  },
                ])
              }
              className="inline-flex h-9 cursor-pointer items-center gap-2 rounded-lg border border-black/10 px-3 text-xs font-semibold"
            >
              <Icon icon="solar:add-circle-linear" width="17" />
              Add project
            </button>
          </div>
          <div className="mt-4 grid gap-3">
            {portfolio.map((project) => (
              <article
                key={project.id}
                className="grid gap-4 rounded-xl border border-black/7 p-4 sm:grid-cols-[150px_minmax(0,1fr)_auto]"
              >
                <div>
                  {project.coverUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={project.coverUrl}
                      alt={`${project.title} cover preview`}
                      className="aspect-[4/3] w-full rounded-xl object-cover"
                    />
                  ) : (
                    <div className="flex aspect-[4/3] w-full items-center justify-center rounded-xl bg-[linear-gradient(135deg,#dcebdd,#c4dec9)] text-[#527052]">
                      <Icon icon="solar:gallery-wide-linear" width="28" />
                    </div>
                  )}
                  <label className="mt-2 flex h-9 cursor-pointer items-center justify-center gap-1.5 rounded-lg border border-black/10 text-[10px] font-semibold">
                    <Icon icon="solar:camera-linear" width="15" />
                    {project.coverUrl ? "Change cover" : "Add cover"}
                    <input
                      type="file"
                      accept="image/png,image/jpeg,image/webp"
                      className="sr-only"
                      onChange={(event) => {
                        const file = event.target.files?.[0];
                        if (!file) return;
                        void readFileAsDataUrl(file).then((coverUrl) => {
                          setPortfolio((current) =>
                            current.map((item) =>
                              item.id === project.id
                                ? { ...item, coverUrl, coverImageId: undefined }
                                : item,
                            ),
                          );
                        });
                      }}
                    />
                  </label>
                  <p className="mt-1.5 text-center text-[9px] leading-4 text-[#91968e]">
                    JPG, PNG, or WebP
                  </p>
                </div>
                <div className="grid min-w-0 gap-3 sm:grid-cols-2">
                  <label className="text-[10px] font-semibold text-[#737870]">
                    Project title
                    <input
                      value={project.title}
                      onChange={(event) =>
                        setPortfolio((current) =>
                          current.map((item) =>
                            item.id === project.id
                              ? { ...item, title: event.target.value }
                              : item,
                          ),
                        )
                      }
                      className="mt-1.5 h-10 w-full rounded-lg border border-black/10 px-3 text-xs font-normal text-[#242724] outline-none focus:border-[#6e916a]"
                    />
                  </label>
                  <label className="text-[10px] font-semibold text-[#737870]">
                    Category
                    <input
                      value={project.category}
                      onChange={(event) =>
                        setPortfolio((current) =>
                          current.map((item) =>
                            item.id === project.id
                              ? { ...item, category: event.target.value }
                              : item,
                          ),
                        )
                      }
                      className="mt-1.5 h-10 w-full rounded-lg border border-black/10 px-3 text-xs font-normal text-[#242724] outline-none focus:border-[#6e916a]"
                    />
                  </label>
                  <label className="text-[10px] font-semibold text-[#737870] sm:col-span-2">
                    Project description
                    <textarea
                      value={project.description}
                      onChange={(event) =>
                        setPortfolio((current) =>
                          current.map((item) =>
                            item.id === project.id
                              ? { ...item, description: event.target.value }
                              : item,
                          ),
                        )
                      }
                      rows={3}
                      placeholder="What did your agency build, and what was the outcome?"
                      className="mt-1.5 w-full resize-none rounded-lg border border-black/10 p-3 text-xs font-normal text-[#242724] outline-none focus:border-[#6e916a]"
                    />
                  </label>
                  <label className="text-[10px] font-semibold text-[#737870] sm:col-span-2">
                    Live link <span className="font-normal">(optional)</span>
                    <input
                      type="url"
                      value={project.link}
                      onChange={(event) =>
                        setPortfolio((current) =>
                          current.map((item) =>
                            item.id === project.id
                              ? { ...item, link: event.target.value }
                              : item,
                          ),
                        )
                      }
                      placeholder="https://project.com"
                      className="mt-1.5 h-10 w-full rounded-lg border border-black/10 px-3 text-xs font-normal text-[#242724] outline-none focus:border-[#6e916a]"
                    />
                  </label>
                </div>
                <button
                  type="button"
                  aria-label={`Remove ${project.title}`}
                  onClick={() =>
                    setPortfolio((current) =>
                      current.filter((item) => item.id !== project.id),
                    )
                  }
                  className="flex h-9 w-9 cursor-pointer items-center justify-center rounded-lg text-[#8b5656] hover:bg-[#f8eeee]"
                >
                  <Icon icon="solar:trash-bin-trash-linear" width="18" />
                </button>
              </article>
            ))}
          </div>
        </section>
        {error && <p className="text-xs text-red-600">{error}</p>}
        {!isComplete && (
          <p className="text-xs text-[#a4453d]">
            Before you can save: {!hasAvatar && "add an avatar"}
            {!hasAvatar && (!hasEnoughTags || !hasPortfolioItem) && ", "}
            {!hasEnoughTags &&
              `add ${5 - tagList.length} more tag${5 - tagList.length === 1 ? "" : "s"}`}
            {!hasEnoughTags && !hasPortfolioItem && ", "}
            {!hasPortfolioItem && "add at least 1 portfolio project"}.
          </p>
        )}
        {isComplete && !isDirty && (
          <p className="text-xs text-[#8a8f87]">No changes to save yet.</p>
        )}
        <button
          type="submit"
          disabled={saving || !isComplete || !isDirty}
          className="h-11 justify-self-start cursor-pointer rounded-xl bg-[#252724] px-5 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50"
        >
          {saving ? "Saving..." : "Save profile"}
        </button>
      </form>
    </Panel>
  );
}

export function MembersPanel() {
  const { getToken } = useAuth();

  const { data: agency, isLoading } = useQuery({
    queryKey: ["agency-mine"],
    queryFn: async () => {
      const token = await getToken();
      const response = await fetch(
        `${process.env.NEXT_PUBLIC_SERVER_URI}/agency/mine?role=freelancer`,
        { headers: { Authorization: `Bearer ${token}` }, cache: "no-store" },
      );
      const result = await response.json();
      if (!response.ok) throw new Error(result.message);
      return result.data as { members: AgencyMemberSummary[] } | null;
    },
  });

  const members = agency?.members ?? [];

  return (
    <Panel
      title="Members & access"
      description="Review who can represent and administer the agency."
    >
      {isLoading ? (
        <p className="px-5 py-10 text-center text-xs text-[#8a8f87] sm:px-6">
          Loading team members...
        </p>
      ) : (
        <div className="divide-y divide-black/6">
          {members.map((member) => (
            <div
              key={member.id}
              className="flex flex-col gap-3 px-5 py-4 sm:flex-row sm:items-center sm:px-6"
            >
              {member.avatarUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={member.avatarUrl}
                  alt=""
                  className="h-10 w-10 shrink-0 rounded-full object-cover"
                />
              ) : (
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[#527a73] text-xs font-semibold text-white">
                  {member.name
                    .split(" ")
                    .map((part) => part[0])
                    .join("")}
                </span>
              )}
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold">{member.name}</p>
                <p className="mt-1 text-xs text-[#7b8078]">
                  {member.isOwner ? "Owner" : member.role}
                </p>
              </div>
            </div>
          ))}
        </div>
      )}
      <div className="border-t border-black/7 p-5 sm:p-6">
        <a
          href="/team"
          className="inline-flex h-11 items-center gap-2 rounded-xl bg-[#252724] px-5 text-sm font-semibold text-white"
        >
          <Icon icon="solar:users-group-rounded-linear" width="18" />
          Manage agency team
        </a>
      </div>
    </Panel>
  );
}

export function VerificationPanel() {
  const { getToken } = useAuth();
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [redirecting, setRedirecting] = useState(false);
  const [error, setError] = useState("");

  const { data: agency } = useQuery({
    queryKey: ["agency-mine"],
    queryFn: async () => {
      const token = await getToken();
      const response = await fetch(
        `${process.env.NEXT_PUBLIC_SERVER_URI}/agency/mine?role=freelancer`,
        { headers: { Authorization: `Bearer ${token}` }, cache: "no-store" },
      );
      const result = await response.json();
      if (!response.ok) throw new Error(result.message);
      return result.data as { members: AgencyMemberSummary[] } | null;
    },
  });

  const { data: verification, isLoading } = useQuery({
    queryKey: ["agency-verification"],
    queryFn: async () => {
      const token = await getToken();
      const response = await fetch(
        `${process.env.NEXT_PUBLIC_SERVER_URI}/agency/verification?role=freelancer`,
        { headers: { Authorization: `Bearer ${token}` }, cache: "no-store" },
      );
      const result = await response.json();
      if (!response.ok) throw new Error(result.message);
      return result.data as { identityVerified: boolean; isOwner: boolean };
    },
  });

  const owner = agency?.members.find((member) => member.isOwner);
  const verified = verification?.identityVerified === true;

  const startVerification = async () => {
    setRedirecting(true);
    setError("");
    try {
      const token = await getToken();
      const response = await fetch(
        `${process.env.NEXT_PUBLIC_SERVER_URI}/identity/session?role=freelancer&context=agency`,
        { method: "POST", headers: { Authorization: `Bearer ${token}` } },
      );
      const result = await response.json();
      if (!response.ok || !result.data?.url) {
        throw new Error(result.message || "Verification could not start.");
      }
      window.location.assign(result.data.url);
    } catch (caughtError) {
      setError(
        caughtError instanceof Error
          ? caughtError.message
          : "Verification could not start.",
      );
      setRedirecting(false);
    }
  };

  return (
    <Panel
      title="Identity verification"
      description="The agency owner completes identity verification securely through Stripe Identity."
    >
      <div className="p-5 sm:p-6">
        <div className="flex flex-wrap items-center gap-4 rounded-xl border border-black/8 p-4">
          {owner?.avatarUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={owner.avatarUrl}
              alt=""
              className="h-11 w-11 shrink-0 rounded-xl object-cover"
            />
          ) : (
            <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-[#edf4ea] text-[#52784f]">
              <Icon icon="solar:user-id-linear" width="22" />
            </span>
          )}
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold">
              {owner?.name ?? "Agency owner"}
            </p>
            <p className="mt-1 text-xs text-[#7b8078]">
              {isLoading
                ? "Checking verification status..."
                : verified
                  ? "Agency owner identity verified by Stripe."
                  : "The agency owner has not verified their identity yet."}
            </p>
          </div>
          {verified ? (
            <span className="inline-flex items-center gap-1.5 rounded-full bg-[#edf4ea] px-3 py-1.5 text-xs font-semibold text-[#52784f]">
              <Icon icon="solar:verified-check-bold" width="15" />
              Verified
            </span>
          ) : verification?.isOwner ? (
            <button
              type="button"
              onClick={() => setConfirmOpen(true)}
              className="h-10 cursor-pointer rounded-xl bg-[#252724] px-4 text-xs font-semibold text-white"
            >
              Verify with Stripe
            </button>
          ) : (
            !isLoading && (
              <span className="text-xs text-[#858a82]">
                Only the agency owner can verify identity.
              </span>
            )
          )}
        </div>
        <p className="mt-4 rounded-xl bg-[#f3f6f1] p-4 text-xs leading-5 text-[#667064]">
          Stripe securely handles identity information. OneMarketplace does not
          manually collect or review identity documents.
        </p>
      </div>

      {confirmOpen && (
        <div className="fixed inset-0 z-90 grid place-items-center bg-[#172018]/45 p-5 backdrop-blur-sm">
          <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-2xl">
            <div className="flex items-start justify-between gap-4">
              <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-[#edf4ea] text-[#52784f]">
                <Icon icon="solar:user-id-linear" width="23" />
              </span>
              <button
                type="button"
                onClick={() => setConfirmOpen(false)}
                disabled={redirecting}
                aria-label="Close verification modal"
              >
                <Icon icon="solar:close-circle-linear" width="23" />
              </button>
            </div>
            <h2 className="mt-4 text-xl font-semibold">Verify your identity</h2>
            <p className="mt-2 text-sm leading-6 text-[#737970]">
              You&apos;ll be redirected to Stripe to securely verify your
              identity as the agency owner. OneMarketplace does not store your
              identity document.
            </p>
            {error && <p className="mt-4 text-xs text-red-600">{error}</p>}
            <div className="mt-6 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setConfirmOpen(false)}
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
      )}
    </Panel>
  );
}

export function NotificationsPanel() {
  return (
    <Panel
      title="Notifications"
      description="How agency activity currently reaches the team."
    >
      <div className="grid gap-3 p-5 sm:p-6">
        {[
          "Proposal and interview activity",
          "Contract and milestone updates",
          "Messages from clients",
          "Agency invitation responses",
          "Payments and withdrawals",
        ].map((label) => (
          <div
            key={label}
            className="flex items-center gap-3 rounded-xl border border-black/7 p-4"
          >
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-[#edf4ea] text-[#52784f]">
              <Icon icon="solar:bell-linear" width="18" />
            </span>
            <span className="text-sm font-medium">{label}</span>
          </div>
        ))}
      </div>
      <p className="border-t border-black/7 px-5 py-4 text-xs leading-5 text-[#7b8078] sm:px-6">
        Every current team member sees these updates in the notification bell in
        real time. Per-notification preferences aren&apos;t configurable yet.
      </p>
    </Panel>
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
    <label className="text-xs font-semibold">
      {label}
      <input
        type={type}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="mt-2 h-11 w-full rounded-xl border border-black/10 px-3 text-sm font-normal outline-none focus:border-[#6e916a]"
      />
    </label>
  );
}

function SelectField({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: string[];
}) {
  return (
    <label className="text-xs font-semibold">
      {label}
      <select
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="mt-2 h-11 w-full rounded-xl border border-black/10 bg-white px-3 text-sm font-normal outline-none focus:border-[#6e916a]"
      >
        {options.map((option) => (
          <option key={option}>{option}</option>
        ))}
      </select>
    </label>
  );
}
