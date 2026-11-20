import { Icon as IconifyIcon } from "@iconify/react";

export type IconName =
  | "home"
  | "proposal"
  | "contract"
  | "team"
  | "message"
  | "wallet"
  | "settings"
  | "bell"
  | "chevron"
  | "search"
  | "arrow"
  | "arrow-left"
  | "arrow-right"
  | "briefcase"
  | "calendar"
  | "chart"
  | "plus"
  | "bookmark"
  | "tuning"
  | "verified"
  | "close"
  | "paperclip"
  | "send"
  | "video"
  | "download"
  | "upload"
  | "check-circle"
  | "flag"
  | "restart-circle"
  | "shield-check"
  | "star"
  | "clock"
  | "money"
  | "question-circle";

const icons: Record<IconName, { default: string; active?: string }> = {
  home: {
    default: "solar:home-2-linear",
    active: "solar:home-2-bold",
  },
  proposal: {
    default: "solar:document-text-linear",
    active: "solar:document-text-bold",
  },
  contract: {
    default: "solar:case-round-linear",
    active: "solar:case-round-bold",
  },
  team: {
    default: "solar:users-group-rounded-linear",
    active: "solar:users-group-rounded-bold",
  },
  message: {
    default: "solar:chat-round-dots-linear",
    active: "solar:chat-round-dots-bold",
  },
  wallet: {
    default: "solar:wallet-money-linear",
    active: "solar:wallet-money-bold",
  },
  settings: {
    default: "solar:settings-linear",
    active: "solar:settings-bold",
  },
  bell: {
    default: "solar:bell-linear",
    active: "solar:bell-bold",
  },
  chevron: { default: "solar:alt-arrow-down-linear" },
  search: { default: "solar:magnifer-linear" },
  arrow: { default: "solar:arrow-right-up-linear" },
  "arrow-left": { default: "solar:arrow-left-linear" },
  "arrow-right": { default: "solar:arrow-right-linear" },
  briefcase: { default: "solar:case-round-linear" },
  calendar: { default: "solar:calendar-linear" },
  chart: { default: "solar:chart-2-linear" },
  plus: { default: "solar:add-circle-linear" },
  bookmark: {
    default: "solar:bookmark-linear",
    active: "solar:bookmark-bold",
  },
  tuning: { default: "solar:tuning-2-linear" },
  verified: { default: "solar:verified-check-bold" },
  close: {
    default: "solar:close-circle-linear",
    active: "solar:close-circle-bold",
  },
  paperclip: { default: "solar:paperclip-linear" },
  send: { default: "solar:plain-2-bold" },
  video: { default: "solar:videocamera-record-linear" },
  download: { default: "solar:download-minimalistic-linear" },
  upload: { default: "solar:upload-minimalistic-linear" },
  "check-circle": { default: "solar:check-circle-bold" },
  flag: { default: "solar:flag-linear" },
  "restart-circle": { default: "solar:restart-circle-linear" },
  "shield-check": { default: "solar:shield-check-bold" },
  star: { default: "solar:star-bold" },
  clock: { default: "solar:clock-circle-linear" },
  money: { default: "solar:hand-money-linear" },
  "question-circle": { default: "solar:question-circle-linear" },
};

export function Icon({
  name,
  size = 20,
  className = "",
  active = false,
}: {
  name: IconName;
  size?: number;
  className?: string;
  active?: boolean;
}) {
  const icon = icons[name];
  return (
    <IconifyIcon
      icon={active && icon.active ? icon.active : icon.default}
      width={size}
      height={size}
      className={className}
      aria-hidden="true"
    />
  );
}
