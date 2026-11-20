import type { Metadata } from "next";
import { PageHeader } from "../../_components/admin-shell";
import {
  Badge,
  EmptyState,
  ErrorBanner,
  Pagination,
  TableShell,
} from "../../_components/ui";
import { fetchAdmin } from "../../_components/fetch-admin";
import { formatDate, initialsFor } from "../../_components/format";

export const metadata: Metadata = { title: "Accounts" };

const PAGE_SIZE = 20;

interface AdminAccount {
  id: string;
  type: "Freelancer" | "Client" | "Agency";
  name: string;
  avatarUrl: string | null;
  email: string;
  verified: boolean;
  paymentVerified: boolean;
  onboarded: boolean;
  createdAt: string;
}

export default async function AccountsPage({
  searchParams,
}: {
  searchParams: Promise<{ offset?: string }>;
}) {
  const offset = Math.max(0, Number((await searchParams).offset) || 0);
  const { data, error } = await fetchAdmin<{
    results: AdminAccount[];
    hasMore: boolean;
  }>(`/admin/accounts?limit=${PAGE_SIZE}&offset=${offset}`);
  const accounts = data?.results ?? [];

  return (
    <>
      <PageHeader
        eyebrow="Directory"
        title="Accounts"
        description="Every freelancer, client, and agency account, newest first."
      />
      {error && <ErrorBanner message={error} />}
      <TableShell
        title="Account explorer"
        description="Clients, freelancers, and agencies in one place"
        count={accounts.length}
        footer={
          <Pagination
            offset={offset}
            limit={PAGE_SIZE}
            count={accounts.length}
            hasMore={data?.hasMore ?? false}
            basePath="/accounts"
          />
        }
      >
        <table className="w-full min-w-180 border-collapse text-left">
          <thead className="bg-[#fafbf9] text-[10px] font-semibold tracking-[.08em] text-[#7c8179] uppercase">
            <tr>
              <th className="px-5 py-3">Account</th>
              <th className="px-5 py-3">Type</th>
              <th className="px-5 py-3">Email</th>
              <th className="px-5 py-3">Status</th>
              <th className="px-5 py-3">Joined</th>
            </tr>
          </thead>
          <tbody>
            {accounts.map((account) => (
              <tr
                key={account.id}
                className="border-t border-black/6 text-xs hover:bg-[#fafbf9]"
              >
                <td className="px-5 py-4">
                  <div className="flex items-center gap-3">
                    {account.avatarUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={account.avatarUrl}
                        alt=""
                        className="h-9 w-9 rounded-full object-cover"
                      />
                    ) : (
                      <span className="flex h-9 w-9 items-center justify-center rounded-full bg-[#527a73] text-[9px] font-semibold text-white">
                        {initialsFor(account.name)}
                      </span>
                    )}
                    <strong>{account.name}</strong>
                  </div>
                </td>
                <td className="px-5 py-4 text-[#71766e]">{account.type}</td>
                <td className="px-5 py-4 text-[#71766e]">{account.email}</td>
                <td className="px-5 py-4">
                  <div className="flex flex-wrap gap-1.5">
                    {account.verified && (
                      <Badge label="Verified" tone="green" />
                    )}
                    {account.onboarded ? (
                      <Badge label="Onboarded" tone="blue" />
                    ) : (
                      <Badge label="Incomplete" tone="amber" />
                    )}
                  </div>
                </td>
                <td className="px-5 py-4 text-[#858a82]">
                  {formatDate(account.createdAt)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {!accounts.length && !error && <EmptyState label="No accounts yet." />}
      </TableShell>
    </>
  );
}
