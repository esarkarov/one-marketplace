const DEV_DATABASE_NAMES = ["onemarketplace"];

export const parseDatabaseName = (url: string | undefined) => {
  if (!url) return null;

  try {
    const name = decodeURIComponent(new URL(url).pathname.replace(/^\//, ""));
    return name || null;
  } catch {
    return null;
  }
};

export const assertTestDatabase = (
  url: string | undefined,
  devDatabase?: string,
) => {
  const fix =
    "Set DATABASE_URL to the test database (for example postgresql://USER:PASSWORD@localhost:5432/onemarketplace_test) and run `pnpm --filter @onemarketplace/api db:test:setup`.";
  const name = parseDatabaseName(url);

  if (!name) {
    throw new Error(
      `DATABASE_URL is missing or invalid, so the test database cannot be determined. ${fix}`,
    );
  }

  if (
    name === devDatabase ||
    DEV_DATABASE_NAMES.includes(name) ||
    !name.endsWith("_test")
  ) {
    throw new Error(
      `Refusing to run tests against database "${name}". Tests need a separate database whose name ends in "_test" and differs from the development database. ${fix}`,
    );
  }
};
