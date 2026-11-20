"use client";

import { Icon } from "@iconify/react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { BrandMark } from "../brand-mark";
import { MarketplaceSearchModal } from "../discovery/marketplace-search-modal";
import { clientHeaderNavigation } from "./navigation";
import { getToken, useClerk, useUser } from "@clerk/nextjs";
import { useQuery } from "@tanstack/react-query";
import Image from "next/image";
import {
  presentNotification,
  useNotifications,
  useNotificationStream,
} from "@/app/hooks/use-notifications";
import { useUnreadMessages } from "@/app/hooks/use-unread-messages";

export function ClientHeader() {
  const pathname = usePathname();
  const unreadMessages = useUnreadMessages();
  const { user } = useUser();
  const { data: profileMetaData } = useQuery({
    queryKey: ["profile-metadata"],
    enabled: Boolean(user),
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
  const { data: contracts = [] } = useQuery<
    Array<{ status: "PENDING" | "ACTIVE" | "COMPLETED" }>
  >({
    queryKey: ["client-contracts"],
    enabled: profileMetaData?.identityVerified === false,
    queryFn: async () => {
      const token = await getToken();
      const response = await fetch(
        `${process.env.NEXT_PUBLIC_SERVER_URI}/contracts/client?role=client`,
        { headers: { Authorization: `Bearer ${token}` } },
      );
      const result = await response.json();
      if (!response.ok) throw new Error(result.message);
      return result.data;
    },
  });
  const showVerificationWarning =
    profileMetaData?.identityVerified === false &&
    contracts.some((contract) => contract.status === "ACTIVE");

  return (
    <>
      {showVerificationWarning && (
        <div className="border-b border-[#a92f2f] bg-[#c83d3d]">
          <div className="mx-auto flex min-h-10 max-w-360 items-center px-5 py-2 sm:px-8">
            <p className="text-xs font-semibold text-white text-center w-full">
              Please verify your identity as soon as possible to prevent account
              restrictions.{" "}
              <Link
                href="/settings?section=verifications&active=true"
                className="pl-2 underline underline-offset-2"
              >
                Verify identity
              </Link>
            </p>
          </div>
        </div>
      )}
      <header className="sticky top-0 z-40 border-b border-black/7 bg-white/95 backdrop-blur">
        <div className="mx-auto flex h-17 max-w-360 items-center gap-5 px-5 sm:px-8">
          <Link href="/" className="flex shrink-0 items-center gap-2.5">
            <BrandMark />
            <span className="hidden text-lg font-semibold tracking-tight sm:block">
              OneMarketplace.io
            </span>
          </Link>
          <nav className="ml-4 hidden items-center gap-1 lg:flex">
            {clientHeaderNavigation.map((item) => {
              const active = pathname === item.href;
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={`rounded-lg px-3 py-2 text-sm transition ${active ? "bg-[#edf4ea] font-semibold text-[#4e774b]" : "font-medium text-[#62675f] hover:bg-black/4"}`}
                >
                  {item.label}
                </Link>
              );
            })}
          </nav>
          <div className="ml-auto flex items-center gap-2 sm:gap-3">
            <MarketplaceSearchModal />
            <Link
              href="/messages"
              aria-label={`${unreadMessages} unread messages`}
              className={`relative hidden h-10 w-10 items-center justify-center rounded-full sm:flex ${pathname === "/messages" ? "bg-[#edf4ea] text-[#4e774b]" : "text-[#60655e] hover:bg-black/5"}`}
            >
              <Icon
                icon={
                  pathname === "/messages"
                    ? "solar:chat-round-dots-bold"
                    : "solar:chat-round-dots-linear"
                }
                width="22"
              />
              {unreadMessages > 0 && <Badge count={unreadMessages} />}
            </Link>
            <Notifications />
            <AccountMenu />
          </div>
        </div>
      </header>
    </>
  );
}

function Badge({ count }: { count: number }) {
  return (
    <span className="absolute top-1.5 right-1.5 flex h-4 min-w-4 items-center justify-center rounded-full border-2 border-white bg-[#5f8d5c] px-1 text-[8px] font-bold text-white">
      {count}
    </span>
  );
}

function Notifications() {
  const [open, setOpen] = useState(false);
  const {
    notifications: data,
    isLoading,
    markAllRead,
    markRead,
  } = useNotifications();
  const notifications = data.slice(0, 3).map(presentNotification);
  const containerRef = useRef<HTMLDivElement>(null);
  const unreadCount = data.filter((item: any) => !item.is_read).length;
  useNotificationStream();

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
        onClick={() => setOpen((value) => !value)}
        aria-label={`${unreadCount} unread notifications`}
        className={`relative flex h-10 w-10 cursor-pointer items-center justify-center rounded-full ${open ? "bg-[#edf4ea] text-[#4e774b]" : "text-[#60655e] hover:bg-black/5"}`}
      >
        <Icon
          icon={open ? "solar:bell-bold" : "solar:bell-linear"}
          width="22"
        />
        {unreadCount > 0 && <Badge count={unreadCount} />}
      </button>
      {open && (
        <section className="fixed top-18 right-3 left-3 overflow-hidden rounded-2xl border border-black/8 bg-white shadow-[0_24px_70px_rgba(26,34,26,.18)] sm:absolute sm:top-12 sm:right-0 sm:left-auto sm:w-100">
          <header className="flex items-center justify-between border-b border-black/7 p-4">
            <div>
              <h2 className="text-sm font-semibold">Notifications</h2>
              <p className="mt-1 text-[10px] text-[#858a82]">
                {unreadCount} unread client updates
              </p>
            </div>
            {unreadCount > 0 && (
              <button
                type="button"
                onClick={() => markAllRead()}
                className="cursor-pointer text-xs font-semibold text-[#52784f]"
              >
                Mark all read
              </button>
            )}
          </header>
          <div className="max-h-105 overflow-y-auto">
            {isLoading &&
              [0, 2].map((_, index) => (
                <div
                  key={index}
                  className="flex animate-pulse gap-3.5 px-5 py-5"
                >
                  <span className="h-10 w-10 rounded-xl bg-[#e8ece6]" />
                  <span className="flex-1">
                    <span className="block h-3 w-36 rounded bg-[#e3e7e1]" />
                    <span className="mt-3 block h-3 w-full rounded bg-[#edf0eb]" />
                  </span>
                </div>
              ))}

            {notifications.map((notification: any, index: any) => (
              <Link
                key={notification.id}
                href={notification.href}
                onClick={() => {
                  markRead(notification.id);
                  setOpen(false);
                }}
                className={`relative flex gap-3.5 px-5 py-4 transition hover:bg-[#f7f8f5] ${
                  index ? "border-t border-black/6" : ""
                } ${notification.unread ? "bg-[#f3f7f1]" : "bg-white"}`}
              >
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-white text-[#52784f] shadow-[inset_0_0_0_1px_rgba(0,0,0,0.06)]">
                  <Icon icon={notification.icon} width="20" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-semibold">
                    {notification.title}
                  </span>
                  <span className="mt-1 block text-xs leading-5 text-[#737870]">
                    {notification.description}
                  </span>
                  <span className="mt-1.5 block text-[11px] text-[#93978f]">
                    {notification.time}
                  </span>
                </span>
                {notification.unread && (
                  <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-[#5f8d5c]" />
                )}
              </Link>
            ))}
          </div>

          {!isLoading && notifications.length === 0 && (
            <div className="px-6 py-10 text-center">
              <span className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-[#edf4ea] text-[#52784f]">
                <Icon icon="solar:bell-off-linear" width="24" />
              </span>
              <p className="mt-3 text-sm font-semibold">No notifications yet</p>
              <p className="mt-1 text-xs text-[#81867e]">
                New account and project updates will appear here.
              </p>
            </div>
          )}
          {isLoading ||
            (notifications.length !== 0 && (
              <footer className="border-t border-black/7 bg-[#fafbf9] p-3">
                <Link
                  href="/notifications"
                  onClick={() => setOpen(false)}
                  className="flex h-10 w-full items-center justify-center rounded-xl text-xs font-semibold text-[#4e774b] hover:bg-[#edf4ea]"
                >
                  View all notifications
                </Link>
              </footer>
            ))}
        </section>
      )}
    </div>
  );
}

function AccountMenu() {
  const [open, setOpen] = useState(false);
  const { user, isLoaded } = useUser();
  const { signOut } = useClerk();

  const { data: profileMetaData } = useQuery({
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
  });

  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (event: MouseEvent) => {
      if (!ref.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [open]);

  const logOutHandler = async () => {
    await signOut();
  };

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        className="flex cursor-pointer items-center gap-2 rounded-full border border-black/8 p-1 pr-2.5 hover:bg-black/3"
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
          className={open ? "rotate-180" : ""}
        />
      </button>
      {open && (
        <div className="absolute top-12 right-0 w-80 overflow-hidden rounded-2xl border border-black/8 bg-white shadow-[0_24px_70px_rgba(26,34,26,.18)]">
          <div className="flex items-center gap-3 border-b border-black/7 p-4">
            <Image
              src={user?.imageUrl!}
              alt={user?.fullName!}
              width={40}
              height={40}
              className="h-11 w-11 rounded-full object-cover"
            />
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <p className="truncate text-sm font-semibold">
                  {user?.fullName}
                </p>
                <span className="rounded-full bg-[#edf4ea] px-2 py-0.5 text-[8px] font-semibold text-[#52784f]">
                  Client
                </span>
              </div>
              <p className="mt-1 truncate text-[10px] text-[#7b8078]">
                {profileMetaData?.companyName}
              </p>
            </div>
          </div>
          <div className="p-2">
            <MenuLink
              href="/profile"
              icon="solar:user-circle-linear"
              label="My profile"
              description="Preview and edit your client profile"
              onNavigate={() => setOpen(false)}
            />
            <MenuLink
              href="/settings?section=finances"
              icon="solar:wallet-money-linear"
              label="Finances"
              description="Cards and billing details"
              onNavigate={() => setOpen(false)}
            />
            <MenuLink
              href="/settings?section=verifications"
              icon="solar:verified-check-linear"
              label="Identity verification"
              description="Secure verification with Stripe"
              onNavigate={() => setOpen(false)}
            />
            <MenuLink
              href="/settings?section=notifications"
              icon="solar:bell-linear"
              label="Notifications"
              description="Manage product and email alerts"
              onNavigate={() => setOpen(false)}
            />
          </div>
          <div className="border-t border-black/7 p-2">
            <button
              type="button"
              data-clerk-account-trigger
              onClick={() => {
                setOpen(false);
                window.location.assign("/settings?section=account");
              }}
              className="flex w-full cursor-pointer items-center gap-3 rounded-xl px-3 py-3 text-left hover:bg-[#f4f6f2]"
            >
              <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-[#f0f3ee] text-[#5d765a]">
                <Icon icon="solar:user-id-linear" width="18" />
              </span>
              <span className="min-w-0 flex-1">
                <strong className="block text-xs">Manage account</strong>
                <span className="mt-1 block text-[9px] font-normal text-[#858a82]">
                  Email, password, and sign-in security
                </span>
              </span>
              <Icon
                icon="solar:alt-arrow-right-linear"
                width="14"
                className="text-[#8a8f87]"
              />
            </button>
            <button
              type="button"
              onClick={() => logOutHandler()}
              className="flex w-full cursor-pointer items-center gap-3 rounded-xl px-3 py-3 text-xs font-semibold text-[#8b5656] hover:bg-[#f8eeee]"
            >
              <Icon icon="solar:logout-2-linear" width="18" /> Log out
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function MenuLink({
  href,
  icon,
  label,
  description,
  onNavigate,
}: {
  href: string;
  icon: string;
  label: string;
  description: string;
  onNavigate: () => void;
}) {
  return (
    <Link
      href={href}
      onClick={onNavigate}
      className="flex items-center gap-3 rounded-xl px-3 py-3 hover:bg-[#f4f6f2]"
    >
      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-[#f0f3ee] text-[#5d765a]">
        <Icon icon={icon} width="18" />
      </span>
      <span className="min-w-0 flex-1">
        <strong className="block text-xs">{label}</strong>
        <span className="mt-1 block truncate text-[9px] font-normal text-[#858a82]">
          {description}
        </span>
      </span>
      <Icon
        icon="solar:alt-arrow-right-linear"
        width="14"
        className="text-[#8a8f87]"
      />
    </Link>
  );
}
