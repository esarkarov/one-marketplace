interface ConnectsHistoryRow {
  id: string;
  type: string;
  description: string;
  amount: number;
  created_at: Date | null;
}

export const toConnectsHistoryEntryResponse = (row: ConnectsHistoryRow) => ({
  id: row.id,
  type: row.type,
  description: row.description,
  connects: row.amount,
  createdAt: row.created_at,
});
