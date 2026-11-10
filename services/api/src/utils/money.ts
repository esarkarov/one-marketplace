export const toMinorUnits = (amount: number): number =>
  Math.round(amount * 100);

export const isValidPayoutAmount = (amount: number): boolean =>
  Number.isFinite(amount) && toMinorUnits(amount) >= 1;
