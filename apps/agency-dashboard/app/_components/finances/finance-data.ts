export const financeSections = [
  { id: "overview", label: "Overview", icon: "chart" },
  { id: "earnings", label: "Earnings", icon: "wallet" },
  { id: "withdrawals", label: "Withdrawals", icon: "arrow" },
  { id: "connects", label: "Agency Connects", icon: "proposal" },
] as const;

export type FinanceSection = (typeof financeSections)[number]["id"];
