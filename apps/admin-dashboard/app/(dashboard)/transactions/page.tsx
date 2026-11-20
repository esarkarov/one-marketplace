import type { Metadata } from "next";
import { PageHeader } from "../../_components/admin-shell";
import {
  formatDateTime,
  unwrap,
  type Components,
} from "@onemarketplace/api-client";
import {
  ApiErrorBanner,
  Badge,
  EmptyState,
  Pagination,
  TableShell,
} from "../../_components/ui";
import { fetchAdmin } from "../../_components/fetch-admin";
import { transactionAmountView } from "../../../lib/money-views";
import { parseOffset } from "../../../lib/labels";

const PAGE_SIZE = 20;

export const metadata: Metadata = { title: "Transactions" };

type TransactionType = Components["schemas"]["AdminTransactionItem"]["type"];

const TYPE_LABEL: Record<TransactionType, string> = {
  MILESTONE_FUNDED: "Milestone funded",
  EARNING: "Earning released",
  PAYOUT: "Payout sent",
  CONNECTS_PURCHASE: "Connects purchase",
};

const TYPE_TONE: Record<TransactionType, "green" | "amber" | "blue" | "gray"> =
  {
    MILESTONE_FUNDED: "blue",
    EARNING: "green",
    PAYOUT: "amber",
    CONNECTS_PURCHASE: "gray",
  };

export default async function TransactionsPage({
  searchParams,
}: {
  searchParams: Promise<{ offset?: string }>;
}) {
  const offset = parseOffset((await searchParams).offset);
  const { data, error } = await fetchAdmin(
    `/transactions?offset=${offset}`,
    (api) =>
      unwrap(
        api.GET("/api/v1/admin/transactions", {
          params: { query: { limit: PAGE_SIZE, offset } },
        }),
      ),
  );
  const transactions = data?.results ?? [];

  return (
    <>
      <PageHeader
        eyebrow="Money movement"
        title="Transactions"
        description="Every escrow funding, earning, payout, and Connects purchase, newest first."
      />
      {error && <ApiErrorBanner error={error} />}
      <TableShell
        title="Transaction ledger"
        description="Merged across milestones, earnings, payouts, and Connects"
        count={transactions.length}
        footer={
          <Pagination
            offset={offset}
            limit={PAGE_SIZE}
            count={transactions.length}
            hasMore={data?.hasMore ?? false}
            basePath="/transactions"
          />
        }
      >
        <table className="w-full min-w-180 border-collapse text-left">
          <thead className="bg-[#fafbf9] text-[10px] font-semibold tracking-[.08em] text-[#7c8179] uppercase">
            <tr>
              <th className="px-5 py-3">Type</th>
              <th className="px-5 py-3">Description</th>
              <th className="px-5 py-3">Party</th>
              <th className="px-5 py-3 text-right">Amount</th>
              <th className="px-5 py-3">Date</th>
            </tr>
          </thead>
          <tbody>
            {transactions.map((transaction) => (
              <tr
                key={`${transaction.type}-${transaction.id}`}
                className="border-t border-black/6 text-xs hover:bg-[#fafbf9]"
              >
                <td className="px-5 py-4">
                  <Badge
                    label={TYPE_LABEL[transaction.type]}
                    tone={TYPE_TONE[transaction.type]}
                  />
                </td>
                <td className="max-w-64 px-5 py-4 text-[#71766e]">
                  <span className="line-clamp-1">
                    {transaction.description}
                  </span>
                </td>
                <td className="px-5 py-4 text-[#71766e]">
                  {transaction.party}
                </td>
                <td className="px-5 py-4 text-right font-semibold">
                  {transactionAmountView(transaction)}
                </td>
                <td className="px-5 py-4 text-[#858a82]">
                  {formatDateTime(transaction.createdAt)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {!transactions.length && !error && (
          <EmptyState label="No transactions yet." />
        )}
      </TableShell>
    </>
  );
}
