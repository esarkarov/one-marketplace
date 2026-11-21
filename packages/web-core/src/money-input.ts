import {
  centsToDollarsString,
  dollarsToCents,
  formatCents,
} from "@onemarketplace/api-client";

export const toCents = (amount: number | string): number | null => {
  try {
    return dollarsToCents(amount);
  } catch {
    return null;
  }
};

export const centsToFormAmount = (cents: number): number =>
  Number(centsToDollarsString(cents));

export interface MoneyBounds {
  minCents: number;
  maxCents: number;
}

export const validateMoneyInput = (
  amount: number | string,
  bounds: MoneyBounds,
): string | null => {
  if (typeof amount === "number" && !Number.isFinite(amount)) {
    return "Enter a valid number.";
  }
  const cents = toCents(amount);
  if (cents === null) return "Use a plain amount with at most 2 decimals.";
  if (cents < bounds.minCents) {
    return `Budget must be at least ${formatCents(bounds.minCents)}.`;
  }
  if (cents > bounds.maxCents) {
    return `Budget cannot exceed ${formatCents(bounds.maxCents)}.`;
  }
  return null;
};
