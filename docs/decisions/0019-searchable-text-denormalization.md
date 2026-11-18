# 0019: Searchable text denormalization

Status: accepted. Batch 1 (schema and write paths) and batch 2 (SQL matching) are implemented.

## Context

Text search on freelancers, agencies and public jobs filters in memory after the page is fetched. It matches Clerk-sourced names and English country names (`Intl.DisplayNames`) that are not in Postgres, so `LIMIT`, `OFFSET` and `hasMore` are wrong for text queries, and the freelancer paths call Clerk once per row.

## Decision

1. **Stored columns.** `accounts.display_name` and `accounts.avatar_url` (nullable) hold the Clerk name and image. `freelancer_metadata.search_text` and `location_text` and `agency_metadata.search_text` (`text not null default ''`) hold normalized lowercase text.
2. **Built in write paths, no triggers.** `buildSearchText` (`src/shared/search/search-text.ts`) lowercases with `toLowerCase()`, trims, collapses whitespace and joins non-empty parts with one space. There is no diacritics folding, which matches today's behaviour. The owning module builds the text in the same transaction as the profile write: freelancer `search_text` is name, title, city, English country name and skills; `location_text` is city and English country name; agency `search_text` is name, title, specialty and tags. Each owner module exports a rebuild function from its `index.ts` for the backfill script.
3. **Agency owner location.** An agency's searchable location is its owner's. It is not copied into `agency_metadata`; batch 2 matches it by joining the owner's `freelancer_metadata.location_text`, so a freelancer location change needs no cross-module write.
4. **Display refresh.** `syncAccountDisplay(authId)` (auth module) fetches the Clerk user once, with a 2000 ms timeout and no retries, and stores name and avatar when they changed. It runs at signup (from the fetch `receiveSignup` already makes), and before the transaction in the freelancer, client and agency profile saves and in agency invitation answers. It is never called inside a transaction.
5. **Clerk failure never fails a user write.** On any failure (error, timeout, key unset, user missing) it logs `account.display_sync.failed` without personal data and returns the stored values. A missing name stays null.
6. **Staleness accepted.** A name or image changed in Clerk is picked up at the next signup or profile save. An optional Clerk `user.updated` webhook may close this gap later.
7. **Matching.** `toSearchTerms` trims, lowercases and splits the query on whitespace (at most 10 terms; the 100-character cap stays). Every term must match (AND) as `ILIKE '%term%' ESCAPE '\'` with `\`, `%` and `_` escaped in the term, built by `matchAllTerms` (`src/shared/search/search-conditions.repository.ts`). Freelancer search matches `freelancer_metadata.search_text`. Agency search matches, per term, `agency_metadata.search_text` or the owner's `freelancer_metadata.location_text`. Public jobs match title, description, skills and the client company name. The marketplace search matches both kinds in one `UNION ALL` ordered by `created_at, id` with a single `LIMIT` and `OFFSET`. A blank query is no filter. A plain `ILIKE` is enough for now. `pg_trgm` (extension available in `postgres:18-alpine`) with a GIN index per table is deferred until a table has thousands of rows.
8. **Backfill.** `scripts/backfill-search-text.ts [--dry-run]` refreshes display data and rebuilds the columns through the owner functions. It is idempotent. No real rows exist yet, so it is needed only if rows are created before batch 2 ships.

## Consequences

- One additive migration (`0005_searchable_text`), five columns, no index and no extension.
- No API request or response shape change. The `query` parameter descriptions in OpenAPI now say terms must all match.
- Old accidental matches are dropped: the literal "Location unavailable", the `, ` separator and bare country codes no longer match. Non-adjacent words in a multi-word query now match.
- The marketplace `all` type is one list ordered by `created_at, id`, so freelancers and agencies interleave instead of freelancers coming first.
- Per-row Clerk calls for response fields (names, avatars, client country) remain until batch 3.
- Rows written before this change have `search_text = ''` until saved again or backfilled.
- Display refreshes do not change `accounts.updated_at`.
- `src/shared/search/` is a new approved `shared/` folder.
