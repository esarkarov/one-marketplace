import { and, or, sql, type SQL, type SQLWrapper } from "drizzle-orm";
import { escapeLikePattern, toSearchTerms } from "./search-terms.js";

export const matchAllTerms = (
  query: string | null | undefined,
  targets: readonly SQLWrapper[],
): SQL | undefined => {
  const terms = toSearchTerms(query);
  if (!terms.length || !targets.length) return undefined;
  return and(
    ...terms.map((term) => {
      const pattern = `%${escapeLikePattern(term)}%`;
      return or(
        ...targets.map((target) => sql`${target} ILIKE ${pattern} ESCAPE '\\'`),
      );
    }),
  );
};
