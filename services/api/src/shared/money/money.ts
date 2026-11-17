import { z } from "zod";

import { PLATFORM_FEE_BPS } from "../../config/constants.js";

export const MAX_MONEY_CENTS = Number.MAX_SAFE_INTEGER;

export const moneyCents = z.number().int().min(0).max(MAX_MONEY_CENTS);

export const isMoneyCents = (value: unknown): value is number =>
  typeof value === "number" && Number.isSafeInteger(value) && value >= 0;

export const toSafeCents = (
  value: string | number | null | undefined,
): number => {
  const cents = Number(value ?? 0);
  if (!Number.isSafeInteger(cents)) {
    throw new RangeError("Aggregated amount exceeds the safe integer range.");
  }
  return cents;
};

const BPS_DENOMINATOR = 10_000n;
const HALF_BPS = 5_000n;

export const splitFee = (
  grossCents: number,
  feeBps: number = PLATFORM_FEE_BPS,
): { feeCents: number; netCents: number } => {
  if (!isMoneyCents(grossCents) || grossCents < 1) {
    throw new RangeError("Gross amount must be a positive integer of cents.");
  }
  if (!Number.isInteger(feeBps) || feeBps < 0 || feeBps >= 10_000) {
    throw new RangeError("Fee basis points must be an integer in [0, 10000).");
  }
  const feeCents = Number(
    (BigInt(grossCents) * BigInt(feeBps) + HALF_BPS) / BPS_DENOMINATOR,
  );
  const netCents = grossCents - feeCents;
  if (netCents < 1) {
    throw new RangeError("Net amount after the platform fee is below 1 cent.");
  }
  return { feeCents, netCents };
};

export const formatUsd = (cents: number): string => {
  if (!isMoneyCents(cents)) {
    throw new RangeError("Amount must be a non-negative integer of cents.");
  }
  const whole = Math.trunc(cents / 100);
  const fraction = String(cents % 100).padStart(2, "0");
  return `$${whole}.${fraction}`;
};

export const formatUsdGrouped = (cents: number): string => {
  if (!isMoneyCents(cents)) {
    throw new RangeError("Amount must be a non-negative integer of cents.");
  }
  const whole = Math.trunc(cents / 100).toLocaleString("en-US");
  return `$${whole}.${String(cents % 100).padStart(2, "0")}`;
};
