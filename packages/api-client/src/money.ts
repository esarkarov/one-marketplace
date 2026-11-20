const DECIMAL = /^(\d+)(?:\.(\d{1,2}))?$/;
const MAX_CENTS = BigInt(Number.MAX_SAFE_INTEGER);

const assertCents = (cents: number): void => {
  if (typeof cents !== "number" || !Number.isSafeInteger(cents)) {
    throw new RangeError("Cents must be a safe integer.");
  }
};

/**
 * Parses a plain decimal ("12", "12.5", "12.50") to integer cents with string
 * parsing, no float math. Rejects negatives, thousands separators, exponents,
 * surrounding whitespace, "12." and ".5", more than 2 decimals, and anything
 * above Number.MAX_SAFE_INTEGER cents. A number is converted through its
 * shortest string form, so 0.1 + 0.2 is rejected.
 */
export const dollarsToCents = (input: string | number): number => {
  if (typeof input === "number" && !Number.isFinite(input)) {
    throw new RangeError("Amount must be a finite number.");
  }

  const text = typeof input === "number" ? String(input) : input;
  const match = typeof text === "string" ? DECIMAL.exec(text) : null;

  if (!match) {
    throw new RangeError(
      "Amount must be a plain decimal with at most 2 decimal places.",
    );
  }

  const cents =
    BigInt(match[1] ?? "0") * 100n + BigInt((match[2] ?? "").padEnd(2, "0"));

  if (cents > MAX_CENTS) {
    throw new RangeError("Amount is too large.");
  }

  return Number(cents);
};

/** 1250 becomes "12.50"; negative cents keep their sign. */
export const centsToDollarsString = (cents: number): string => {
  assertCents(cents);
  const negative = cents < 0;
  const absolute = BigInt(Math.abs(cents));
  const whole = absolute / 100n;
  const fraction = (absolute % 100n).toString().padStart(2, "0");
  return `${negative ? "-" : ""}${whole}.${fraction}`;
};

export const formatCents = (
  cents: number,
  currency = "USD",
  locale = "en-US",
): string => {
  assertCents(cents);
  return new Intl.NumberFormat(locale, { style: "currency", currency }).format(
    centsToDollarsString(cents) as `${number}`,
  );
};
