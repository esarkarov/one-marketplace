const collectStrings = (value: unknown, found: string[]): string[] => {
  if (typeof value === "string") found.push(value);
  else if (Array.isArray(value)) {
    for (const item of value) collectStrings(item, found);
  } else if (value !== null && typeof value === "object") {
    for (const item of Object.values(value)) collectStrings(item, found);
  }
  return found;
};

export const findClerkIdLeaks = (
  body: unknown,
  clerkIds: readonly string[],
): string[] => {
  const strings = collectStrings(body, []);
  return clerkIds.filter((clerkId) =>
    strings.some((value) => value.includes(clerkId)),
  );
};

export const expectNoClerkIds = (
  body: unknown,
  clerkIds: readonly string[],
): void => {
  if (!clerkIds.length) {
    throw new Error("expectNoClerkIds needs at least one Clerk id to scan for");
  }
  const leaked = findClerkIdLeaks(body, clerkIds);
  if (leaked.length) {
    throw new Error(`Response exposes Clerk ids: ${leaked.join(", ")}`);
  }
};
