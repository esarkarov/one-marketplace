const collectKeys = (value: unknown, found: string[]): string[] => {
  if (Array.isArray(value)) {
    for (const item of value) collectKeys(item, found);
  } else if (value !== null && typeof value === "object") {
    for (const [key, item] of Object.entries(value)) {
      found.push(key);
      collectKeys(item, found);
    }
  }
  return found;
};

export const findForbiddenKeys = (
  body: unknown,
  forbidden: readonly string[],
): string[] => {
  const keys = new Set(collectKeys(body, []));
  return forbidden.filter((key) => keys.has(key));
};

export const STORED_NORMALIZATION_KEYS = ["content_norm", "contentNorm"];

export const expectNoStoredNormalization = (body: unknown): void => {
  const leaked = findForbiddenKeys(body, STORED_NORMALIZATION_KEYS);
  if (leaked.length) {
    throw new Error(`Response exposes stored columns: ${leaked.join(", ")}`);
  }
};
