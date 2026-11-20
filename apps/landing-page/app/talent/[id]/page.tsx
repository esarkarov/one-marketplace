import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Header } from "../../_components/landing-page/header";
import styles from "./profile.module.css";
import Image from "next/image";

interface PortfolioItem {
  id: string;
  title: string;
  category: string;
  description: string;
  live_url: string | null;
  cover_image: { imageId: string; url: string };
}

interface WorkHistoryItem {
  id: string;
  title: string;
  client: string;
  status: "ACTIVE" | "COMPLETED";
  completed: string | null;
  created_at: string;
  rating: number | null;
  review: string | null;
  clientHasReviewed: boolean;
  freelancerHasReviewed: boolean;
}

interface TalentProfile {
  id: string;
  name: string;
  avatarUrl: string | null;
  professional_title: string;
  professional_description: string;
  hourly_rate: string;
  country: string;
  city: string;
  availability_status: string;
  weekly_availability: string;
  experience_level: string;
  skills: string[];
  languages: Array<{ language: string; proficiency: string }>;
  identityVerified: boolean;
  joined_at: string | null;
  portfolios: PortfolioItem[];
  agency: { id: string; name: string; avatarUrl: string | null } | null;
  stats: {
    totalEarning: number;
    completedJobs: number;
    reviewCount: number;
    jobSuccessScore: number;
    rating: number | null;
  };
  workHistory: WorkHistoryItem[];
}

const AVATAR_BACKGROUNDS = [
  "linear-gradient(135deg, #925f46, #c58c6e)",
  "linear-gradient(135deg, #466b72, #73a2a8)",
  "linear-gradient(135deg, #6f668e, #a095bd)",
  "linear-gradient(135deg, #8b6f48, #bea071)",
  "linear-gradient(135deg, #46634b, #7ca181)",
  "linear-gradient(135deg, #566f8c, #87a5c4)",
  "linear-gradient(135deg, #8c5366, #bd8094)",
  "linear-gradient(135deg, #5b6d91, #8d9dc0)",
];

function backgroundFor(id: string) {
  let hash = 0;
  for (let index = 0; index < id.length; index += 1) {
    hash = (hash * 31 + id.charCodeAt(index)) >>> 0;
  }
  return AVATAR_BACKGROUNDS[hash % AVATAR_BACKGROUNDS.length];
}

function initialsFor(name: string) {
  return (
    name
      .split(" ")
      .filter(Boolean)
      .map((part) => part[0])
      .join("")
      .slice(0, 2)
      .toUpperCase() || "?"
  );
}

const regionNames = new Intl.DisplayNames(["en"], { type: "region" });

function locationFor(profile: TalentProfile) {
  const countryName = profile.country
    ? (regionNames.of(profile.country) ?? profile.country)
    : null;
  return [profile.city, countryName].filter(Boolean).join(", ");
}

function earningsTierFor(totalEarning: number) {
  if (totalEarning <= 0) return "New on OneMarketplace";
  if (totalEarning < 1000) return `$${Math.round(totalEarning)}`;
  return `$${Math.floor(totalEarning / 1000)}k+`;
}

function periodFor(item: WorkHistoryItem) {
  const start = new Date(item.created_at).getFullYear();
  if (item.status === "ACTIVE") return `${start} — Present`;
  const end = item.completed ? new Date(item.completed).getFullYear() : start;
  return start === end ? `${start}` : `${start} — ${end}`;
}

async function getTalentProfile(id: string): Promise<TalentProfile | null> {
  const response = await fetch(
    `${process.env.NEXT_PUBLIC_SERVER_URI}/freelancer/profile/${id}`,
    { cache: "no-store" },
  );
  if (response.status === 404) return null;
  if (!response.ok) return null;
  const result = await response.json();
  return result.data as TalentProfile;
}

interface TalentProfilePageProps {
  params: Promise<{ id: string }>;
}

export async function generateMetadata({
  params,
}: TalentProfilePageProps): Promise<Metadata> {
  const profile = await getTalentProfile((await params).id);
  return {
    title: profile
      ? `${profile.name} — ${profile.professional_title} | OneMarketplace.io`
      : "Talent profile | OneMarketplace.io",
  };
}

export default async function TalentProfilePage({
  params,
}: TalentProfilePageProps) {
  const { id } = await params;
  const profile = await getTalentProfile(id);
  if (!profile) notFound();

  const location = locationFor(profile);
  const initials = initialsFor(profile.name);
  const background = backgroundFor(profile.id);
  const reviews = profile.workHistory.filter((item) => item.review);
  const memberSinceYear = profile.joined_at
    ? new Date(profile.joined_at).getFullYear()
    : null;

  return (
    <div className="min-h-svh bg-[#f7f8f5] font-(family-name:--font-dm-sans) text-[#20231f]">
      <Header />
      <main>
        <div className="mx-auto max-w-7xl px-5 py-6 sm:px-8 lg:px-10">
          <nav
            className="flex items-center gap-2 text-sm text-[#747870]"
            aria-label="Breadcrumb"
          >
            <Link href="/talents" className="hover:text-[#3f683d]">
              Talent
            </Link>
            <span aria-hidden="true">/</span>
            <span className="truncate text-[#3e423d]">{profile.name}</span>
          </nav>
        </div>

        <section className="mx-auto max-w-7xl px-5 sm:px-8 lg:px-10">
          <div className="relative overflow-hidden rounded-3xl border border-black/6 bg-[#e6efe3] p-6 sm:p-9 lg:p-11">
            <div
              className="absolute inset-0 bg-[radial-gradient(circle_at_78%_18%,rgba(255,255,255,0.8),transparent_30%),radial-gradient(circle_at_82%_100%,rgba(159,196,154,0.48),transparent_36%)]"
              aria-hidden="true"
            ></div>
            <div className="relative flex flex-col justify-between gap-8 lg:flex-row lg:items-end">
              <div className="flex flex-col gap-6 sm:flex-row sm:items-center">
                {profile.avatarUrl ? (
                  <Image
                    src={profile.avatarUrl}
                    width={40}
                    height={40}
                    alt=""
                    className="h-28 w-28 shrink-0 rounded-full object-cover shadow-lg shadow-black/8 sm:h-32 sm:w-32"
                  />
                ) : (
                  <div
                    className="flex h-28 w-28 shrink-0 items-center justify-center rounded-full text-2xl font-bold text-white shadow-lg shadow-black/8 sm:h-32 sm:w-32"
                    style={{ background }}
                  >
                    {initials}
                  </div>
                )}
                <div>
                  <div className="flex flex-wrap items-center gap-3">
                    <h1 className={`${styles.profileTitle} text-[#182019]`}>
                      {profile.name}
                    </h1>
                    {profile.identityVerified && (
                      <span
                        className="inline-flex items-center gap-1.5 rounded-full bg-white/75 px-2.5 py-1 text-xs font-semibold text-[#477344]"
                        title="Identity verified with Stripe"
                      >
                        <svg
                          viewBox="0 0 16 16"
                          className="h-3.5 w-3.5"
                          aria-hidden="true"
                        >
                          <path
                            fill="currentColor"
                            d="m8 1.3 1.55 1.12 1.9-.04.55 1.82 1.56 1.08-.63 1.8.63 1.8L12 9.96l-.55 1.82-1.9-.04L8 12.86l-1.55-1.12-1.9.04L4 9.96 2.44 8.88l.63-1.8-.63-1.8L4 4.2l.55-1.82 1.9.04L8 1.3Z"
                          />
                          <path
                            fill="white"
                            d="m6.9 10.55-2.1-2.1.95-.95L6.9 8.65l3.35-3.35.95.95-4.3 4.3Z"
                          />
                        </svg>
                        Identity verified
                      </span>
                    )}
                  </div>
                  <p className="mt-2 text-lg text-[#596358]">
                    {profile.professional_title}
                  </p>
                  <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-2 text-sm text-[#677065]">
                    <span className="inline-flex items-center gap-2">
                      <span
                        className={`h-2 w-2 rounded-full ${
                          profile.availability_status === "AVAILABLE"
                            ? "bg-[#559856]"
                            : "bg-[#b5b8b2]"
                        }`}
                      ></span>
                      {profile.availability_status === "AVAILABLE"
                        ? "Available now"
                        : "Currently busy"}
                    </span>
                    {location && <span>{location}</span>}
                  </div>
                </div>
              </div>
              <div className="flex flex-wrap gap-3">
                <Link
                  href="/signup?role=client"
                  className="rounded-xl border border-black/10 cursor-pointer bg-white/70 px-4 py-3 text-sm font-semibold transition hover:bg-white"
                >
                  Save profile
                </Link>
                <Link
                  href="/signup?role=client"
                  className="rounded-xl bg-[#252724] px-5 py-3 text-sm font-semibold text-white! transition hover:bg-[#3b3e39]"
                >
                  Invite to a job
                </Link>
              </div>
            </div>
          </div>

          <div className="relative z-10 mx-4 -mt-5 grid grid-cols-2 overflow-hidden rounded-2xl border border-black/7 bg-white shadow-xl shadow-black/4 sm:mx-8 sm:grid-cols-4 lg:mx-12">
            {[
              ["Job success", `${Math.round(profile.stats.jobSuccessScore)}%`],
              ["Projects completed", profile.stats.completedJobs],
              [
                "Client rating",
                profile.stats.rating
                  ? `${profile.stats.rating.toFixed(1)} / 5`
                  : "New",
              ],
              ["Total earned", earningsTierFor(profile.stats.totalEarning)],
            ].map(([label, value], index) => (
              <div
                key={label}
                className={`px-4 py-5 text-center ${index > 0 ? "sm:border-l sm:border-black/7" : ""} ${index > 1 ? "border-t border-black/7 sm:border-t-0" : ""}`}
              >
                <p className="text-lg font-semibold">{value}</p>
                <p className="mt-1 text-xs text-[#81857e]">{label}</p>
              </div>
            ))}
          </div>
        </section>

        <div className="mx-auto grid max-w-7xl items-start gap-7 px-5 py-12 sm:px-8 lg:grid-cols-[1fr_20rem] lg:px-10">
          <div className="space-y-7">
            <section className="rounded-2xl border border-black/7 bg-white p-6 sm:p-8">
              <h2 className={styles.sectionTitle}>About</h2>
              <p className="mt-4 max-w-3xl text-sm leading-7 text-[#646862] sm:text-base">
                {profile.professional_description}
              </p>
              <div className="mt-6 flex flex-wrap gap-2">
                {profile.skills.map((skill) => (
                  <span
                    key={skill}
                    className="rounded-lg bg-[#eef2ec] px-3 py-2 text-xs font-semibold text-[#596257]"
                  >
                    {skill}
                  </span>
                ))}
              </div>
            </section>

            {profile.agency && (
              <section className="rounded-2xl border border-black/7 bg-white p-6 sm:p-8">
                <p className="text-xs font-semibold uppercase tracking-[0.13em] text-[#62805f]">
                  Associated with
                </p>
                <Link
                  href={`/agency/${profile.agency.id}`}
                  className="mt-4 flex items-center gap-3 rounded-xl p-2 -m-2 transition hover:bg-[#f5f6f3]"
                >
                  {profile.agency.avatarUrl ? (
                    <Image
                      src={profile.agency.avatarUrl}
                      alt=""
                      width={60}
                      height={60}
                      className="h-11 w-11 shrink-0 rounded-xl object-cover"
                    />
                  ) : (
                    <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-[#496e67] text-sm font-semibold text-white">
                      {initialsFor(profile.agency.name)}
                    </span>
                  )}
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-semibold">
                      {profile.agency.name}
                    </span>
                    <span className="block text-xs text-[#477344]">
                      View agency profile
                    </span>
                  </span>
                </Link>
              </section>
            )}

            {profile.portfolios.length > 0 && (
              <section className="rounded-2xl border border-black/7 bg-white p-6 sm:p-8">
                <div className="flex items-end justify-between gap-4">
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-[0.13em] text-[#62805f]">
                      Selected work
                    </p>
                    <h2 className={`${styles.sectionTitle} mt-2`}>Portfolio</h2>
                  </div>
                </div>
                <div className="mt-6 grid gap-4 sm:grid-cols-3">
                  {profile.portfolios.map((project) => (
                    <article key={project.id}>
                      <div className="relative aspect-4/3 overflow-hidden rounded-xl bg-[#e9efe6]">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                          src={project.cover_image.url}
                          alt={project.title}
                          className="h-full w-full object-cover"
                        />
                      </div>
                      <h3 className={`${styles.itemTitle} mt-3`}>
                        {project.title}
                      </h3>
                      <p className="mt-1 text-xs text-[#81857e]">
                        {project.category}
                      </p>
                    </article>
                  ))}
                </div>
              </section>
            )}

            {reviews.length > 0 && (
              <section className="rounded-2xl border border-black/7 bg-white p-6 sm:p-8">
                <h2 className={styles.sectionTitle}>Client reviews</h2>
                <div className="mt-6 grid gap-4 sm:grid-cols-2">
                  {reviews.map((item) => (
                    <article
                      key={item.id}
                      className="rounded-xl bg-[#f5f7f3] p-5"
                    >
                      <p className="text-sm tracking-widest text-[#d2a43b]">
                        {"★".repeat(item.rating ?? 0)}
                        {"☆".repeat(5 - (item.rating ?? 0))}
                      </p>
                      <blockquote className="mt-3 text-sm leading-6 text-[#555a53]">
                        &ldquo;{item.review}&rdquo;
                      </blockquote>
                      <p className="mt-5 text-sm font-semibold">
                        {item.client}
                      </p>
                      <p className="mt-1 text-xs text-[#83877f]">
                        {item.title}
                      </p>
                    </article>
                  ))}
                </div>
                {profile.stats.rating !== null && (
                  <p className="mt-5 text-sm text-[#6f746c]">
                    {profile.stats.rating.toFixed(1)} average from{" "}
                    {profile.stats.reviewCount} verified client reviews
                  </p>
                )}
              </section>
            )}

            {profile.workHistory.length > 0 && (
              <section className="rounded-2xl border border-black/7 bg-white p-6 sm:p-8">
                <h2 className={styles.sectionTitle}>Work history</h2>
                <div className="mt-6 space-y-6">
                  {profile.workHistory.map((item) => (
                    <div
                      key={item.id}
                      className="grid gap-2 border-l-2 border-[#c9ddc5] pl-5 sm:grid-cols-[1fr_auto]"
                    >
                      <div>
                        <h3 className={styles.itemTitle}>{item.title}</h3>
                        <p className="mt-1 text-sm text-[#73776f]">
                          {item.client}
                        </p>
                      </div>
                      <p className="text-xs font-medium text-[#8a8e87]">
                        {periodFor(item)}
                      </p>
                    </div>
                  ))}
                </div>
              </section>
            )}
          </div>

          <aside className="sticky top-24 rounded-2xl border border-black/7 bg-white p-6 shadow-lg shadow-black/3">
            <p className="text-xs font-semibold uppercase tracking-[0.13em] text-[#688065]">
              Work with {profile.name.split(" ")[0]}
            </p>
            <p className="mt-4 text-3xl font-semibold tracking-tight">
              ${Number(profile.hourly_rate)}
              <span className="text-base font-normal text-[#7d817a]">/hr</span>
            </p>
            <Link
              href="/signup?role=client"
              className="mt-6 block rounded-xl bg-[#252724] px-4 py-3 text-center text-sm font-semibold text-white! transition hover:bg-[#3b3e39]"
            >
              Invite to a job
            </Link>
            <Link
              href="/signup?role=client"
              className="mt-3 block rounded-xl text-center border border-black/10 px-4 py-3 text-sm font-semibold transition hover:bg-[#f5f6f3]"
            >
              Send a message
            </Link>
            <div className="mt-6 space-y-4 border-t border-black/7 pt-6 text-sm">
              <div className="flex items-center justify-between gap-4">
                <span className="text-[#7a7e77]">Weekly availability</span>
                <span className="font-semibold">
                  {profile.weekly_availability}
                </span>
              </div>
              <div className="flex items-center justify-between gap-4">
                <span className="text-[#7a7e77]">Experience level</span>
                <span className="font-semibold">
                  {profile.experience_level}
                </span>
              </div>
              {profile.languages.map(({ language, proficiency }) => (
                <div
                  key={language}
                  className="flex items-center justify-between gap-4"
                >
                  <span className="text-[#7a7e77]">{language}</span>
                  <span className="font-semibold">{proficiency}</span>
                </div>
              ))}
              {memberSinceYear && (
                <div className="flex items-center justify-between gap-4">
                  <span className="text-[#7a7e77]">Member since</span>
                  <span className="font-semibold">{memberSinceYear}</span>
                </div>
              )}
            </div>
            <div className="mt-6 rounded-xl bg-[#edf4ea] p-4">
              <p className="text-xs font-semibold text-[#4a7047]">
                OneMarketplace protected
              </p>
              <p className="mt-1 text-xs leading-5 text-[#6b7769]">
                Secure payments, verified work history, and dedicated support.
              </p>
            </div>
          </aside>
        </div>
      </main>
    </div>
  );
}
