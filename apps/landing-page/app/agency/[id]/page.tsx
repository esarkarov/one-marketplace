import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Header } from "../../_components/landing-page/header";
import styles from "./agency-profile.module.css";

interface AgencyPortfolioItem {
  id: string;
  title: string;
  category: string;
  description: string;
  liveUrl: string | null;
  coverImage: { imageId: string; url: string };
}

interface AgencyMember {
  id: string;
  freelancerId: string;
  profileId: string | null;
  name: string;
  avatarUrl: string | null;
  role: string;
  skills: string[];
  isOwner: boolean;
  rating: number;
  jobSuccessScore: number;
  completedProjects: number;
}

interface AgencyWorkHistoryItem {
  id: string;
  title: string;
  client: string;
  status: "ACTIVE" | "COMPLETED";
  completed: string | null;
  rating: number | null;
  review: string | null;
}

interface AgencyProfile {
  id: string;
  name: string;
  professionalTitle: string | null;
  size: string;
  specialty: string;
  website: string | null;
  overview: string;
  tags: string[];
  avatarImage: { imageId: string; url: string } | null;
  portfolio: AgencyPortfolioItem[];
  ownerLocation: string | null;
  ownerLanguageDetails: Array<{ language: string; proficiency: string }>;
  members: AgencyMember[];
  createdAt: string | null;
  stats: {
    totalEarning: number;
    completedJobs: number;
    reviewCount: number;
    jobSuccessScore: number;
    rating: number | null;
  };
  workHistory: AgencyWorkHistoryItem[];
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

function earningsTierFor(totalEarning: number) {
  if (totalEarning <= 0) return "New on OneMarketplace";
  if (totalEarning < 1000) return `$${Math.round(totalEarning)}`;
  return `$${Math.floor(totalEarning / 1000)}k+`;
}

async function getAgencyProfile(id: string): Promise<AgencyProfile | null> {
  const response = await fetch(
    `${process.env.NEXT_PUBLIC_SERVER_URI}/agency/profile/${id}`,
    { cache: "no-store" },
  );
  if (response.status === 404) return null;
  if (!response.ok) return null;
  const result = await response.json();
  return result.data as AgencyProfile;
}

interface AgencyProfilePageProps {
  params: Promise<{ id: string }>;
}

export async function generateMetadata({
  params,
}: AgencyProfilePageProps): Promise<Metadata> {
  const agency = await getAgencyProfile((await params).id);
  return {
    title: agency
      ? `${agency.name} — Agency profile | OneMarketplace.io`
      : "Agency profile | OneMarketplace.io",
  };
}

export default async function AgencyProfilePage({
  params,
}: AgencyProfilePageProps) {
  const { id } = await params;
  const agency = await getAgencyProfile(id);
  if (!agency) notFound();

  const initials = initialsFor(agency.name);
  const reviews = agency.workHistory.filter((item) => item.review);
  const foundedYear = agency.createdAt
    ? new Date(agency.createdAt).getFullYear()
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
            <Link href="/agencies" className="hover:text-[#3f683d]">
              Agencies
            </Link>
            <span aria-hidden="true">/</span>
            <span className="truncate text-[#3e423d]">{agency.name}</span>
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
                {agency.avatarImage ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={agency.avatarImage.url}
                    alt=""
                    className="h-28 w-28 shrink-0 rounded-3xl object-cover shadow-lg shadow-black/8 sm:h-32 sm:w-32"
                  />
                ) : (
                  <div className="flex h-28 w-28 shrink-0 items-center justify-center rounded-3xl bg-[#496e67] text-2xl font-bold text-white shadow-lg shadow-black/8 sm:h-32 sm:w-32">
                    {initials}
                  </div>
                )}
                <div>
                  <h1 className={`${styles.profileTitle} text-[#182019]`}>
                    {agency.name}
                  </h1>
                  <p className="mt-2 text-lg text-[#596358]">
                    {agency.professionalTitle || agency.specialty}
                  </p>
                  <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-2 text-sm text-[#677065]">
                    <span>{agency.specialty}</span>
                    {agency.ownerLocation && (
                      <span>{agency.ownerLocation}</span>
                    )}
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
                  Hire this agency
                </Link>
              </div>
            </div>
          </div>

          <div className="relative z-10 mx-4 -mt-5 grid grid-cols-2 overflow-hidden rounded-2xl border border-black/7 bg-white shadow-xl shadow-black/4 sm:mx-8 sm:grid-cols-4 lg:mx-12">
            {[
              ["Job success", `${Math.round(agency.stats.jobSuccessScore)}%`],
              ["Projects completed", agency.stats.completedJobs],
              [
                "Client rating",
                agency.stats.rating
                  ? `${agency.stats.rating.toFixed(1)} / 5`
                  : "New",
              ],
              ["Total earned", earningsTierFor(agency.stats.totalEarning)],
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
                {agency.overview}
              </p>
              <div className="mt-6 flex flex-wrap gap-2">
                {agency.tags.map((tag) => (
                  <span
                    key={tag}
                    className="rounded-lg bg-[#eef2ec] px-3 py-2 text-xs font-semibold text-[#596257]"
                  >
                    {tag}
                  </span>
                ))}
              </div>
            </section>

            {agency.members.length > 0 && (
              <section className="rounded-2xl border border-black/7 bg-white p-6 sm:p-8">
                <p className="text-xs font-semibold uppercase tracking-[0.13em] text-[#62805f]">
                  Our specialists
                </p>
                <h2 className={`${styles.sectionTitle} mt-2`}>Agency team</h2>
                <div className="mt-6 grid gap-4 sm:grid-cols-2">
                  {agency.members.map((member) => {
                    const memberInitials = initialsFor(member.name);
                    const card = (
                      <div className="flex items-start gap-3 rounded-xl border border-black/7 p-4 transition hover:bg-[#f5f6f3]">
                        {member.avatarUrl ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img
                            src={member.avatarUrl}
                            alt=""
                            className="h-11 w-11 shrink-0 rounded-full object-cover"
                          />
                        ) : (
                          <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-[#496e67] text-sm font-semibold text-white">
                            {memberInitials}
                          </span>
                        )}
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm font-semibold">
                            {member.name}
                            {member.isOwner && (
                              <span className="ml-1.5 text-xs font-normal text-[#858a82]">
                                (Owner)
                              </span>
                            )}
                          </p>
                          <p className="mt-0.5 text-xs text-[#73776f]">
                            {member.role}
                          </p>
                        </div>
                      </div>
                    );
                    return member.profileId ? (
                      <Link
                        key={member.id}
                        href={`/talent/${member.profileId}`}
                      >
                        {card}
                      </Link>
                    ) : (
                      <div key={member.id}>{card}</div>
                    );
                  })}
                </div>
              </section>
            )}

            {agency.portfolio.length > 0 && (
              <section className="rounded-2xl border border-black/7 bg-white p-6 sm:p-8">
                <p className="text-xs font-semibold uppercase tracking-[0.13em] text-[#62805f]">
                  Selected work
                </p>
                <h2 className={`${styles.sectionTitle} mt-2`}>Portfolio</h2>
                <div className="mt-6 grid gap-4 sm:grid-cols-3">
                  {agency.portfolio.map((project) => (
                    <article key={project.id}>
                      <div className="relative aspect-4/3 overflow-hidden rounded-xl bg-[#e9efe6]">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                          src={project.coverImage.url}
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
                {agency.stats.rating !== null && (
                  <p className="mt-5 text-sm text-[#6f746c]">
                    {agency.stats.rating.toFixed(1)} average from{" "}
                    {agency.stats.reviewCount} verified client reviews
                  </p>
                )}
              </section>
            )}

            {agency.workHistory.length > 0 && (
              <section className="rounded-2xl border border-black/7 bg-white p-6 sm:p-8">
                <h2 className={styles.sectionTitle}>Work history</h2>
                <div className="mt-6 space-y-6">
                  {agency.workHistory.map((item) => (
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
                        {item.status === "ACTIVE" ? "In progress" : "Completed"}
                      </p>
                    </div>
                  ))}
                </div>
              </section>
            )}
          </div>

          <aside className="sticky top-24 rounded-2xl border border-black/7 bg-white p-6 shadow-lg shadow-black/3">
            <p className="text-xs font-semibold uppercase tracking-[0.13em] text-[#688065]">
              Work with {agency.name}
            </p>
            <Link
              href="/signup?role=client"
              className="mt-6 block rounded-xl bg-[#252724] px-4 py-3 text-center text-sm font-semibold text-white! transition hover:bg-[#3b3e39]"
            >
              Hire this agency
            </Link>
            <Link
              href="/signup?role=client"
              className="mt-3 block rounded-xl text-center border border-black/10 px-4 py-3 text-sm font-semibold transition hover:bg-[#f5f6f3]"
            >
              Send a message
            </Link>
            <div className="mt-6 space-y-4 border-t border-black/7 pt-6 text-sm">
              <div className="flex items-center justify-between gap-4">
                <span className="text-[#7a7e77]">Team size</span>
                <span className="font-semibold">{agency.size}</span>
              </div>
              <div className="flex items-start justify-between gap-4">
                <span className="shrink-0 text-[#7a7e77]">Specialty</span>
                <span className="text-right font-semibold">
                  {agency.specialty}
                </span>
              </div>
              {foundedYear && (
                <div className="flex items-center justify-between gap-4">
                  <span className="text-[#7a7e77]">Founded</span>
                  <span className="font-semibold">{foundedYear}</span>
                </div>
              )}
              {agency.website && (
                <div className="flex items-center justify-between gap-4">
                  <span className="text-[#7a7e77]">Website</span>
                  <a
                    href={agency.website}
                    target="_blank"
                    rel="noreferrer"
                    className="truncate font-semibold text-[#477344] hover:underline"
                  >
                    Visit
                  </a>
                </div>
              )}
              {agency.ownerLanguageDetails.map(({ language, proficiency }) => (
                <div
                  key={language}
                  className="flex items-center justify-between gap-4"
                >
                  <span className="text-[#7a7e77]">{language}</span>
                  <span className="font-semibold">{proficiency}</span>
                </div>
              ))}
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
