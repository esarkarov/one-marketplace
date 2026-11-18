import { sql } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";
import { matchAllTerms } from "./search-conditions.repository.js";

const render = (query: string | undefined) => {
  const condition = matchAllTerms(query, [sql`a`, sql`b`]);
  return condition ? new PgDialect().sqlToQuery(condition) : undefined;
};

describe("matchAllTerms", () => {
  it("builds no condition for an empty query", () => {
    expect(render("  ")).toBeUndefined();
    expect(render(undefined)).toBeUndefined();
  });

  it("ANDs the terms and ORs the targets with a literal ESCAPE", () => {
    const rendered = render("Foo bar");
    expect(rendered?.sql).toBe(
      "((a ILIKE $1 ESCAPE '\\' or b ILIKE $2 ESCAPE '\\') and (a ILIKE $3 ESCAPE '\\' or b ILIKE $4 ESCAPE '\\'))",
    );
    expect(rendered?.params).toEqual(["%foo%", "%foo%", "%bar%", "%bar%"]);
  });

  it("escapes wildcards in the bound pattern", () => {
    expect(render("50%_x")?.params[0]).toBe("%50\\%\\_x%");
  });
});
