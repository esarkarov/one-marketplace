import { legacyDollarsToCents } from "../utils/money.js";

/**
 * Exists only for messages published before the cents migration. Remove once
 * no v1 message can remain in any queue or the DLQ.
 */
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
