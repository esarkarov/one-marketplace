"use client";

import { Icon } from "@iconify/react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { clientSidebarNavigation } from "./navigation";
import { getToken, useUser } from "@clerk/nextjs";
import Image from "next/image";
import { useQuery } from "@tanstack/react-query";

export function ClientSidebar() {
  const { user, isLoaded } = useUser();
  const pathname = usePathname();

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

  return (
    <aside className="hidden xl:sticky xl:top-24 xl:block">
      <section className="rounded-2xl border border-black/8 bg-white p-5">
        <div className="flex items-center gap-3">
          {!user ? (
            <span className="flex h-12 w-12 items-center justify-center rounded-full bg-[#496e67] text-sm font-semibold text-white">
              ...
            </span>
          ) : (
            <Image
              src={user.imageUrl}
              alt=""
              width={60}
              height={60}
              className="h-12 w-12 object-cover rounded-full"
            />
          )}

          <div>
            <h2 className="text-sm font-semibold">
              {!isLoaded ? "..." : user?.fullName}
            </h2>
            <p className="mt-1 text-xs text-[#858a82]">
              {profileMetaDataLoading ? "..." : profileMetaData?.companyName}
            </p>
          </div>
        </div>
        <div className="mt-5 border-t border-black/7 pt-4">
          <p className="text-[10px] font-semibold tracking-[.12em] text-[#6e826c] uppercase">
            Client account
          </p>
          <Link
            href="/profile"
            className="mt-2 inline-flex items-center gap-1.5 text-xs font-semibold text-[#52784f] hover:underline"
          >
            View profile
            <Icon icon="solar:arrow-right-up-linear" width="14" />
          </Link>
        </div>
      </section>
      <nav className="mt-5 rounded-2xl border border-black/8 bg-white p-2">
        {clientSidebarNavigation.map((item) => {
          const itemPath = item.href.split("?")[0];
          const active =
            itemPath === "/"
              ? pathname === "/"
              : pathname === itemPath || pathname.startsWith(`${itemPath}/`);
          return (
            <Link
              key={item.href}
              href={item.href}
              className={`flex items-center gap-3 rounded-xl px-3 py-3 text-sm font-medium ${active ? "bg-[#edf4ea] text-[#4e774b]" : "text-[#686d65] hover:bg-black/3"}`}
            >
              <Icon
                icon={
                  active ? item.icon.replace("-linear", "-bold") : item.icon
                }
                width="19"
              />
              {item.label}
            </Link>
          );
        })}
      </nav>
    </aside>
  );
}
