"use client";

import { getToken, useClerk, useUser } from "@clerk/nextjs";
import { Icon } from "@iconify/react";
import { useQuery } from "@tanstack/react-query";
import Image from "next/image";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";

const accountItems = [
  {
    href: "/my-profile",
    label: "My profile",
    description: "Preview and edit your profile",
    icon: "solar:user-circle-linear",
  },
  {
    href: "/settings?section=overview",
    label: "Account settings",
    description: "Payments, security, and preferences",
    icon: "solar:settings-linear",
  },
  {
    href: "/notifications",
    label: "Notifications",
    description: "Review your account activity",
    icon: "solar:bell-linear",
  },
] as const;

export function AccountDropdown() {
  const [open, setOpen] = useState(false);
  const { user, isLoaded } = useUser();

  const { data: profileMetaData, isLoading: profileMetaDataLoading } = useQuery(
    {
      queryKey: ["profile-metadata"],
      enabled: Boolean(user),
      queryFn: async () => {
        const token = await getToken();

        const response = await fetch(
          `${process.env.NEXT_PUBLIC_SERVER_URI}/freelancer/profile?role=freelancer`,
          {
            headers: {
              Authorization: `Bearer ${token}`,
            },
            cache: "no-store",
          },
        );

        const result = await response.json();

        if (!response.ok) {
          throw new Error(
            result.message || "The client profile could not be loaded.",
          );
        }

        return result.data;
      },
    },
  );

  const { data: agencyMembership } = useQuery({
    queryKey: ["agency-membership"],
    enabled: Boolean(user),
    queryFn: async () => {
      const token = await getToken();

      const response = await fetch(
        `${process.env.NEXT_PUBLIC_SERVER_URI}/agency/membership?role=freelancer`,
        {
          headers: {
            Authorization: `Bearer ${token}`,
          },
          cache: "no-store",
        },
      );

      const result = await response.json();

      if (!response.ok) {
        throw new Error(
          result.message || "The agency membership could not be loaded.",
        );
      }

      return result.data as { agencyId: string | null };
    },
  });
  const hasAgency = Boolean(agencyMembership?.agencyId);
  const containerRef = useRef<HTMLDivElement>(null);
  const { signOut } = useClerk();

  const logOutHandler = async () => {
    await signOut();
  };

  useEffect(() => {
    if (!open) return;

    const handlePointerDown = (event: MouseEvent) => {
      if (!containerRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };

    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [open]);

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        aria-label="Open account menu"
        aria-expanded={open}
        aria-haspopup="menu"
        onClick={() => setOpen((current) => !current)}
        className={`flex cursor-pointer items-center gap-2 rounded-full border p-1 pr-2.5 transition ${
          open
            ? "border-[#aec2aa] bg-[#edf4ea]"
            : "border-black/8 hover:bg-black/3"
        }`}
      >
        {isLoaded ? (
          <Image
            src={user?.imageUrl!}
            alt={user?.fullName!}
            width={40}
            height={40}
            className="h-8 w-8 rounded-full object-cover"
          />
        ) : (
          <span className="flex h-8 w-8 items-center justify-center rounded-full bg-[#496e67] text-sm font-semibold text-white">
            ...
          </span>
        )}

        <Icon
          icon="solar:alt-arrow-down-linear"
          width="16"
          className={`hidden transition-transform sm:block ${open ? "rotate-180" : ""}`}
        />
      </button>

      {open && (
        <div
          role="menu"
          aria-label="Account menu"
          className="fixed top-17 right-3 z-50 w-[calc(100vw-1.5rem)] overflow-hidden rounded-2xl border border-black/8 bg-white shadow-[0_24px_70px_rgba(26,34,26,0.18)] sm:absolute sm:top-12 sm:right-0 sm:w-80"
        >
          <div className="flex items-center gap-3 border-b border-black/7 p-4">
            <Image
              src={user?.imageUrl!}
              alt={user?.fullName!}
              width={40}
              height={40}
              className="h-11 w-11 rounded-full object-cover"
            />
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-semibold">{user?.fullName}</p>
              <p className="mt-0.5 truncate text-[11px] text-[#7b8078]">
                {profileMetaDataLoading
                  ? "Loading..."
                  : profileMetaData?.professional_title}
              </p>
            </div>
            <span className="rounded-full bg-[#e6f2e3] px-2 py-1 text-[9px] font-semibold text-[#477344]">
              Online
            </span>
          </div>

          <div className="p-2">
            {accountItems.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                role="menuitem"
                onClick={() => setOpen(false)}
                className="flex items-center gap-3 rounded-xl px-3 py-3 transition hover:bg-[#f4f6f2]"
              >
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-[#f0f3ee] text-[#5d765a]">
                  <Icon icon={item.icon} width="19" />
                </span>
                <span className="min-w-0 flex-1">
                  <strong className="block text-xs">{item.label}</strong>
                  <span className="mt-0.5 block truncate text-[10px] text-[#858a82]">
                    {item.description}
                  </span>
                </span>
                <Icon
                  icon="solar:alt-arrow-right-linear"
                  width="15"
                  className="text-[#92978f]"
                />
              </Link>
            ))}
          </div>

          <div className="border-t border-black/7 p-2">
            <Link
              href={
                hasAgency
                  ? process.env.NEXT_PUBLIC_AGENCY_DASHBOARD!
                  : "/settings?section=agency"
              }
              role="menuitem"
              onClick={() => setOpen(false)}
              className="flex items-center gap-3 rounded-xl px-3 py-3 transition hover:bg-[#f4f6f2]"
            >
              <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-[#f0f3ee] text-[#5d765a]">
                <Icon icon="solar:buildings-2-linear" width="19" />
              </span>
              <span className="min-w-0 flex-1">
                <strong className="block text-xs">
                  {hasAgency ? "Switch to agency" : "Create an agency"}
                </strong>
                <span className="mt-0.5 block truncate text-[10px] text-[#858a82]">
                  {hasAgency
                    ? "Open your agency workspace"
                    : "Build and manage a team"}
                </span>
              </span>
              <Icon icon="solar:arrow-right-up-linear" width="15" />
            </Link>
          </div>

          <div className="border-t border-black/7 p-2">
            <button
              type="button"
              role="menuitem"
              onClick={logOutHandler}
              className="flex w-full cursor-pointer items-center gap-3 rounded-xl px-3 py-3 text-left text-[#8b5656] transition hover:bg-[#f8eeee]"
            >
              <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-[#f7eeee]">
                <Icon icon="solar:logout-2-linear" width="19" />
              </span>
              <span className="text-xs font-semibold">Log out</span>
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
