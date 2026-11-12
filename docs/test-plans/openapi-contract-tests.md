# Test plan: OpenAPI contract tests (Stage 9b)

## Scope

- Response schemas in `services/api/src/modules/<module>/<module>.responses.ts` and `src/routes/health.responses.ts`, the central schemas in `src/shared/validation/response-schemas.ts`, the generator in `src/openapi/` and the committed spec `docs/api/openapi.json`. Design and the unverified list: `docs/decisions/0012-openapi-contract-from-zod.md`.
- Use only the `_test` database with Stripe, ImageKit, Clerk and Daily mocked. Never use or print the real `.env`.

## Test files

| File                                                                                            | Covers                                                                                                                                                                                                                                                                                              |
| ----------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/modules/<module>/*.contract.test.ts` (13 files, plus `src/routes/health.contract.test.ts`) | Integration: real requests on the `_test` database, the real response strictly parsed with the declared schema (status code and body)                                                                                                                                                               |
| `src/routes/route-contract-check.test.ts`                                                       | Registry: every route declares a 2xx response or is in `src/routes/contract-allowlist.ts` (4 webhooks, 2 event streams, each with a reason); no stale allowlist entries; synthetic routers prove each check fails                                                                                   |
| `src/openapi/openapi-spec.test.ts`                                                              | Structural: committed spec equals generated; every `$ref` resolves; operationIds unique; security and responses on every operation; every path param declared; no empty schemas; `*Cents` fields are integers; money-name guard (fields named like money but not `*Cents` must be in its allowlist) |
| `src/openapi/convert-schema.test.ts`                                                            | Unit: zod to JSON Schema converter fixtures (strict objects, nullable, optional, enums, coercion, unions, bigint cents)                                                                                                                                                                             |
| `src/shared/validation/response-schemas.test.ts`                                                | Unit: central 400, 401, 429 and 500 schemas against hand-written samples only                                                                                                                                                                                                                       |

## How to run

```
pnpm --filter @onemarketplace/api test:quiet src/openapi
pnpm --filter @onemarketplace/api test:quiet src/routes
pnpm --filter @onemarketplace/api test:quiet src/shared
pnpm --filter @onemarketplace/api test:quiet src/modules/<module>/<module>.contract
pnpm --filter @onemarketplace/api db:test:setup
pnpm --filter @onemarketplace/api test:quiet
```

Contract tests need Docker Postgres with the test database (`db:test:setup`). Last full run before this plan: 93 files, 1556 tests, 0 skipped, with only the flake below.

## Known gaps (schemas no test parses)

The full list is in ADR 0012, section "Unverified response schemas". Counts by status class (43 declared schemas):

| Class | Count | Where                                                                                          |
| ----- | ----- | ---------------------------------------------------------------------------------------------- |
| 400   | 18    | admin, agency (5), auth, client, contracts (2), freelancer, jobs (2), messaging (4), proposals |
| 403   | 18    | jobs (6), client (5), freelancer (5), agency, proposals                                        |
| 404   | 5     | agency, client (2), freelancer (2)                                                             |
| 423   | 1     | messaging send                                                                                 |
| 503   | 1     | `/ready`                                                                                       |

- Every 2xx schema, `/health` and `/ready` 200 are verified. connects, identity, meetings and notifications have no gaps.
- Central 400, 401, 429 and 500 components are checked only with hand-written samples, not against a real response.
- Recommended next step: one table-driven error-contract test per module (wrong role gives 403, bad body gives 400, missing row gives 404) parsed with the declared schema. Integration level.

## Test-isolation rules

1. Each contract test owns a unique id prefix and purges only rows with that prefix. Never reuse another suite's prefix. The admin contract test once reused the payouts factories' `TEST_PREFIX` (`payout-it-`) and its purge deleted the payouts test's rows. `createTestData` and `purgeLeftovers` in `src/test/support/factories.ts` now take an optional prefix.
2. The payouts integration tests run a worker that sweeps all eligible earnings in the database (`earning_history` older than the hold period without a payout). Any other test seeding an old earning must either keep it inside the hold period (`ageMs: 0`) or insert it fresh, attach its payout, then backdate it. Done in the admin, agency and freelancer contract tests. New contract tests that need old earnings must follow the same pattern.
3. Failure signature of a breach: payouts or contract tests fail intermittently only in the full run, passing alone.

## Known flake (not caused by this stage)

- `src/modules/meetings/meetings.webhook.test.ts`, "rejects a timestamp too far in the future": it uses now+301s against a 300s tolerance, so more than 1s of load delay lets the request pass. Seen once in about ten full runs.
- Suggested fix, not applied: use a margin such as +600s.

## Manual checks

1. Determinism: run `pnpm --filter @onemarketplace/api openapi:generate` twice and compare the bytes of `docs/api/openapi.json` (for example `git hash-object` after each run). Expected: identical, with LF line endings.
2. Drift in CI: change a response schema without regenerating. Expected: `openapi-spec.test.ts` fails locally and the CI step "Fail if the OpenAPI spec is stale" (`git diff --exit-code -- docs/api/openapi.json`) fails after "Regenerate OpenAPI spec".
3. The CI step compares the working tree with the commit, so it detects drift only if the spec is already committed. An uncommitted or untracked `docs/api/openapi.json` is not diffed against anything useful. Commit the spec with the change.
4. The generator needs no secrets, database or extra env entries (it sets its own dummy environment); confirm it runs with an empty environment.

## Cases by level

- Unit: converter fixtures, central response schema samples, money-name guard, `*Cents` integer rule.
- Integration: all `*.contract.test.ts`, the registry test, the structural spec test (reads the committed file and the router).
- End to end: none needed for the contract; typed-client generation is out of scope (ADR 0012).
- Not blocked on any "to confirm" rule; response shapes document current behaviour, including inconsistencies.
