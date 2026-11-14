export interface Pagination {
  limit: number;
  offset: number;
}

export interface PaginatedResult<T> {
  results: T[];
  hasMore: boolean;
}

export type AdminTransactionRow =
  | {
      id: string;
      type: "MILESTONE_FUNDED";
      description: string;
      party: string;
      amountCents: number;
      createdAt: Date | null;
    }
  | {
      id: string;
      type: "EARNING";
      description: string;
      party: string;
      amountCents: number;
      createdAt: Date | null;
    }
  | {
      id: string;
      type: "PAYOUT";
      description: string;
      party: string;
      amountCents: number;
      createdAt: Date | null;
    }
  | {
      id: string;
      type: "CONNECTS_PURCHASE";
      description: string;
      party: string;
      amountCents: number;
      createdAt: Date | null;
    };
