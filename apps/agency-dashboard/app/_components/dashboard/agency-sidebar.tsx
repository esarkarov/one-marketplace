"use client";

import { useAuth } from "@clerk/nextjs";
import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Icon } from "../ui/icon";
import { agencyNavigation } from "./navigation";

interface AgencySummary {
  name: string;
  professionalTitle: string | null;
  website: string | null;
  tags: string[];
  avatarImage: { imageId: string; url: string } | null;
  portfolio: unknown[];
  members: unknown[];
}

const getInitials = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((word) => word[0]?.toUpperCase())
    .join("") || "?";

export function AgencySidebar() {
  const pathname = usePathname();
  const { getToken } = useAuth();

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
        throw new Error(result.message || "The agency could not be loaded.");
      }

      return result.data as AgencySummary | null;
    },
  });

  const hasAvatar = Boolean(agency?.avatarImage);
  const hasProfessionalTitle = Boolean(agency?.professionalTitle);
  const hasWebsite = Boolean(agency?.website);
  const tags = agency?.tags ?? [];
  const portfolio = agency?.portfolio ?? [];
  const members = agency?.members ?? [];

  const strength = Number(
    (
      (hasAvatar ? 20 : 0) +
      (hasProfessionalTitle ? 15 : 0) +
      (hasWebsite ? 10 : 0) +
      Math.min(tags.length / 5, 1) * 20 +
      Math.min(portfolio.length / 3, 1) * 25 +
      Math.min(Math.max(members.length - 1, 0) / 3, 1) * 10
    ).toFixed(2),
  );

  const missingTags = Math.max(5 - tags.length, 0);
  const missingPortfolio = Math.max(3 - portfolio.length, 0);
  const missingTeammates = Math.max(3 - Math.max(members.length - 1, 0), 0);

  const strengthSuggestions = [
    !hasAvatar && "Add an agency logo.",
    !hasProfessionalTitle && "Add a professional title.",
    !hasWebsite && "Add your agency website.",
    missingTags > 0 &&
      `Add ${missingTags} more skill tag${missingTags === 1 ? "" : "s"}.`,
    missingPortfolio > 0 &&
      `Add ${missingPortfolio} more portfolio project${missingPortfolio === 1 ? "" : "s"}.`,
    missingTeammates > 0 &&
      `Add ${missingTeammates} more team member${missingTeammates === 1 ? "" : "s"}.`,
  ].filter(Boolean) as string[];

  return (
    <aside className="grid gap-5 xl:sticky xl:top-24">
      {isLoading ? (
        <section
          aria-label="Loading agency summary"
          aria-busy="true"
          className="rounded-2xl border border-black/8 bg-white p-5"
        >
          <div className="animate-pulse">
            <div className="flex items-center gap-3">
              <div className="h-12 w-12 shrink-0 rounded-xl bg-[#dce3d9]" />
              <div className="flex-1">
                <div className="h-4 w-3/4 rounded-full bg-[#e1e5de]" />
                <div className="mt-2 h-3 w-1/2 rounded-full bg-[#e9ece6]" />
              </div>
            </div>
            <div className="mt-5 h-1.5 rounded-full bg-[#e1e5de]" />
          </div>
        </section>
      ) : (
        <section className="min-w-0 rounded-2xl border border-black/8 bg-white p-5">
          <div className="flex items-center gap-3">
            {agency?.avatarImage ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={agency.avatarImage.url}
                alt=""
                className="h-12 w-12 shrink-0 rounded-xl object-cover"
              />
            ) : (
              <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-[#496e67] text-sm font-semibold text-white">
                {getInitials(agency?.name ?? "?")}
              </span>
            )}
            <div className="min-w-0">
              <h2 className="truncate font-semibold">
                {agency?.name ?? "Your agency"}
              </h2>
              <p className="truncate text-xs text-[#7b8078]">
                {members.length} team member{members.length === 1 ? "" : "s"}
              </p>
            </div>
          </div>
          <div className="mt-5 flex items-center justify-between text-xs">
            <span className="font-medium">Agency profile</span>
            <strong className="text-[#52784f]">{strength}%</strong>
            {!isLoading && strength < 100 && (
              <span className="group relative">
                <button
                  type="button"
                  aria-label="How to complete your agency profile"
                  className="flex h-4 w-4 cursor-help items-center justify-center rounded-full border border-[#789075] text-[10px] font-bold text-[#52784f]"
                >
                  ?
                </button>
                <span className="pointer-events-none absolute right-0 bottom-6 z-20 hidden w-56 rounded-xl bg-[#252724] p-3 text-left text-[11px] leading-5 font-normal text-white shadow-xl group-hover:block group-focus-within:block">
                  <strong className="mb-1 block font-semibold">
                    Reach 100%
                  </strong>
                  {strengthSuggestions.map((suggestion) => (
                    <span key={suggestion} className="block text-white/75">
                      • {suggestion}
                    </span>
                  ))}
                </span>
              </span>
            )}
          </div>
          <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-[#e6e9e3]">
            <div
              className="h-full rounded-full bg-[#648b61]"
              style={{ width: `${strength}%` }}
            />
          </div>
          <Link
            href={"/profile"}
            className="mt-4 inline-block text-xs font-semibold text-[#4e774b] hover:underline"
          >
            Preview agency profile
          </Link>
        </section>
      )}
      <nav className="rounded-2xl border border-black/8 bg-white p-2 text-sm">
        {agencyNavigation.map((item) => {
          const itemPath = item.href.split("?")[0];
          const active =
            itemPath === "/" ? pathname === "/" : pathname.startsWith(itemPath);
          return (
            <Link
              key={item.href}
              href={item.href}
              className={`flex items-center gap-3 rounded-xl px-3 py-3 font-medium transition ${active ? "bg-[#edf4ea] text-[#4e774b]" : "text-[#686d65] hover:bg-black/3"}`}
            >
              <Icon name={item.icon} size={19} active={active} />
              {item.label}
            </Link>
          );
        })}
      </nav>
    </aside>
  );
}
