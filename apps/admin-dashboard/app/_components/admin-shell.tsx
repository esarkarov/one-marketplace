"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { AdminIcon } from "./admin-icon";
import type { IconName } from "./admin-icon";

const navigation: Array<{ label: string; icon: IconName; href: string }> = [
  { label: "Overview", icon: "grid", href: "/" },
  { label: "Accounts", icon: "users", href: "/accounts" },
  { label: "Job Posts", icon: "jobs", href: "/job-posts" },
  { label: "Proposals", icon: "proposal", href: "/proposals" },
  { label: "Contracts", icon: "contract", href: "/contracts" },
  { label: "Transactions", icon: "wallet", href: "/transactions" },
  { label: "Logs", icon: "logs", href: "/logs" },
  { label: "Systems", icon: "server", href: "/systems" },
];

export function AdminShell({ children }: { children: React.ReactNode }) {
  const [menuOpen, setMenuOpen] = useState(false);
  const pathname = usePathname();

  return (
    <div className="min-h-svh bg-[#f4f6f2] text-[#242724]">
      <header className="sticky top-0 z-40 border-b border-black/7 bg-white/95 backdrop-blur">
        <div className="mx-auto flex h-17 max-w-400 items-center gap-4 px-5 sm:px-8">
          <button
            type="button"
            onClick={() => setMenuOpen((value) => !value)}
            aria-label="Toggle admin navigation"
            className="flex h-10 w-10 items-center justify-center rounded-xl border border-black/8 lg:hidden"
          >
            <AdminIcon name={menuOpen ? "close" : "menu"} />
          </button>
          <Link href="/" className="flex items-center gap-2.5">
            <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-[#252724] text-white">
              <AdminIcon name="grid" size={18} />
            </span>
            <span className="hidden text-lg font-semibold sm:block">
              OneMarketplace.io
            </span>
          </Link>
          <span className="rounded-full bg-[#e8eee5] px-2.5 py-1 text-[9px] font-semibold tracking-[.08em] text-[#52784f] uppercase">
            Admin
          </span>
          <button
            type="button"
            onClick={async () => {
              await fetch("/api/session", { method: "DELETE" });
              window.location.href = "/login";
            }}
            className="ml-auto flex h-9 items-center gap-1.5 rounded-xl border border-black/8 px-3 text-xs font-semibold text-[#656b63] hover:bg-[#f5f6f3]"
          >
            Log out
          </button>
        </div>
      </header>

      <div className="mx-auto grid max-w-400 lg:grid-cols-[250px_minmax(0,1fr)]">
        <aside
          className={`${
            menuOpen ? "fixed inset-x-4 top-20 z-50 block shadow-2xl" : "hidden"
          } h-fit rounded-2xl border border-black/8 bg-white p-2 lg:sticky lg:top-21 lg:m-6 lg:block lg:shadow-none`}
        >
          <div className="border-b border-black/7 px-3 py-3">
            <p className="text-[10px] font-semibold tracking-[.14em] text-[#7c8179] uppercase">
              Operations console
            </p>
          </div>
          <nav className="mt-2">
            {navigation.map((item) => {
              const active =
                item.href === "/"
                  ? pathname === "/"
                  : pathname.startsWith(item.href);
              return (
                <Link
                  key={item.label}
                  href={item.href}
                  onClick={() => setMenuOpen(false)}
                  className={`flex items-center gap-3 rounded-xl px-3 py-3 text-sm ${
                    active
                      ? "bg-[#edf4ea] font-semibold text-[#4e774b]"
                      : "text-[#656b63] hover:bg-[#f5f6f3]"
                  }`}
                >
                  <AdminIcon name={item.icon} size={18} />
                  <span className="flex-1">{item.label}</span>
                </Link>
              );
            })}
          </nav>
        </aside>

        <main className="min-w-0 px-5 py-7 sm:px-8 lg:py-10 lg:pl-0">
          {children}
        </main>
      </div>
    </div>
  );
}

export function PageHeader({
  eyebrow,
  title,
  description,
}: {
  eyebrow: string;
  title: string;
  description: string;
}) {
  return (
    <div>
      <p className="text-xs font-semibold tracking-[.14em] text-[#62805f] uppercase">
        {eyebrow}
      </p>
      <h1 className="mt-2 text-3xl font-semibold tracking-[-.045em] sm:text-4xl">
        {title}
      </h1>
      <p className="mt-2 text-sm text-[#72776f]">{description}</p>
    </div>
  );
}
