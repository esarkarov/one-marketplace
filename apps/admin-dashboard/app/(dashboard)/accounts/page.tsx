import type { Metadata } from "next";
import { PageHeader } from "../../_components/admin-shell";
import { formatDateTime, unwrap } from "@onemarketplace/api-client";
import {
  ApiErrorBanner,
  Badge,
  EmptyState,
  Pagination,
  TableShell,
} from "../../_components/ui";
import { fetchAdmin } from "../../_components/fetch-admin";
import { initialsFor } from "../../_components/format";
import { ACCOUNT_TYPE_LABEL, parseOffset } from "../../../lib/labels";

export const metadata: Metadata = { title: "Accounts" };

const PAGE_SIZE = 20;

export default async function AccountsPage({
  searchParams,
}: {
  searchParams: Promise<{ offset?: string }>;
}) {
  const offset = parseOffset((await searchParams).offset);
  const { data, error } = await fetchAdmin(
    `/accounts?offset=${offset}`,
    (api) =>
      unwrap(
        api.GET("/api/v1/admin/accounts", {
          params: { query: { limit: PAGE_SIZE, offset } },
        }),
      ),
  );
  const accounts = data?.results ?? [];

  return (
    <>
      <PageHeader
        eyebrow="Directory"
        title="Accounts"
        description="Every freelancer, client, and agency account, newest first."
      />
      {error && <ApiErrorBanner error={error} />}
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
                <td className="px-5 py-4 text-[#71766e]">
                  {ACCOUNT_TYPE_LABEL[account.type]}
                </td>
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
                  {formatDateTime(account.createdAt)}
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
