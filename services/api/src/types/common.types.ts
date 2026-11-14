export interface ApiResponse<T> {
  success: boolean;
  message: string;
  data?: T;
  requestId?: string;
}

export type StripeRequirementsLike =
  | {
      entries?: Array<{
        awaiting_action_from: string;
        minimum_deadline: { status: string };
      }>;
    }
  | undefined;
