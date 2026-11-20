import type { Metadata } from "next";
import { ContractsDashboard } from "./contracts-dashboard";
import { Suspense } from "react";

export const metadata: Metadata = {
  title: "My Contracts | OneMarketplace.io",
  description:
    "Manage active freelance contracts, milestones, and submissions.",
};

export default function ContractsPage() {
  return (
    <Suspense>
      <ContractsDashboard />
    </Suspense>
  );
}
