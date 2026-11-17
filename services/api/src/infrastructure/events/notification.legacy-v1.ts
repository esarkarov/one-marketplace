import { legacyDollarsToCents } from "../../shared/money/money.js";

export const upgradeV1Metadata = (
  metadata: Record<string, unknown> | undefined,
): Record<string, unknown> | undefined => {
  if (!metadata || !("amount" in metadata)) return metadata;
  const { amount, ...rest } = metadata;
  if ("amountCents" in rest) {
    throw new RangeError("amount and amountCents are both present");
  }
  if (typeof amount !== "number") {
    throw new RangeError("amount must be a number");
  }
  return { ...rest, amountCents: legacyDollarsToCents(amount) };
};
