import { REFUND_RECONCILIATION } from "@/modules/contracts/constants/contracts.constants.js";

export const stripeErrorFields = (error: unknown) => {
  if (typeof error !== "object" || error === null) return {};
  const fields = error as {
    code?: unknown;
    type?: unknown;
    name?: unknown;
    statusCode?: unknown;
  };
  return {
    code: typeof fields.code === "string" ? fields.code : undefined,
    type: typeof fields.type === "string" ? fields.type : undefined,
    name: typeof fields.name === "string" ? fields.name : undefined,
    statusCode:
      typeof fields.statusCode === "number" ? fields.statusCode : undefined,
  };
};

export const isStripeUnavailable = (error: unknown) => {
  const { type, statusCode } = stripeErrorFields(error);
  return (
    type === "StripeConnectionError" ||
    type === "StripeRateLimitError" ||
    statusCode === 429 ||
    (statusCode !== undefined && statusCode >= 500)
  );
};

export const isPermanentRefundCode = (
  code: string | undefined,
): code is string =>
  code !== undefined &&
  (REFUND_RECONCILIATION.permanentErrorCodes as readonly string[]).includes(
    code,
  );
