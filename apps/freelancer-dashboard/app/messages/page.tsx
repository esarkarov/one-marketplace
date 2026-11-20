import type { Metadata } from "next";
import { DashboardHeader } from "../_components/dashboard/dashboard-header";
import { WorkspaceSidebar } from "../_components/dashboard/workspace-sidebar";
import { MessagesDashboard } from "./messages-dashboard";

export const metadata: Metadata = {
  title: "Messages | OneMarketplace.io",
  description: "Chat with clients and coordinate project meetings.",
};

export default async function MessagesPage({
  searchParams,
}: {
  searchParams: Promise<{ conversationId?: string }>;
}) {
  const { conversationId } = await searchParams;

  return (
    <div className="min-h-svh bg-[#f4f6f2] font-(family-name:--font-dm-sans) text-[#242724]">
      <DashboardHeader />
      <main className="mx-auto max-w-360 px-5 py-6 sm:px-8 lg:py-8">
        <div className="grid items-start gap-6 xl:grid-cols-[240px_minmax(0,1fr)]">
          <div className="hidden xl:block">
            <WorkspaceSidebar />
          </div>
          <MessagesDashboard conversationId={conversationId} />
        </div>
      </main>
    </div>
  );
}
