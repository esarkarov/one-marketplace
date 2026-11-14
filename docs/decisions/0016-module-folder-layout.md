# 0016: Module folder layout

Status: proposed, in progress. Supersedes parts of ADR 0013, ADR 0014 and ADR 0015 (list below) once accepted in stage S11.

## Context

After ADR 0014 the 14 modules under `services/api/src/modules/` (198 files) are flat, except `contracts`, which splits services and tests into folders. A module of 20 files mixes controllers, services, repositories, zod schemas, responses, tables and tests in one directory, and ADR 0014 section 1 makes the shape depend on a size threshold. One folder set for every module makes a file's role visible from its path and removes the threshold.

## Decision

1. **Folder set.** Every module is `modules/<name>/` with `controllers/`, `services/`, `repositories/`, `models/`, `schemas/`, `responses/`, `middleware/` and `tests/`, plus `types/`, `constants/` and `utils/`. Folders exist only when they hold files, so `payouts` has no `controllers/` and `identity` has no `models/`; empty folders are not created.
2. **Module root.** The root keeps `<name>.route.ts`, `<name>.public.ts` and the entry points wired by `bootstrap/` (`<name>.socket.ts`, `<name>.cron.ts`, `<name>.consumer.ts`), for the same reason `route` stays: `routes/` and `bootstrap/` assemble them.
3. **Naming.** `models/<name>.model.ts` holds the module's Drizzle tables and enums. `schemas/<x>.schema.ts` holds zod request schemas. `responses/<x>.responses.ts` holds zod response schemas. `.model` means drizzle and `.schema` means zod; the old `<name>.schema.ts` (drizzle) disappears from the module root. Tests live in `tests/` under their current names.
4. **Homes for the other files.**
   - `*.middleware.ts` goes to `middleware/`.
   - `notifications.sse.ts` goes to `services/`.
   - `agency.errors.ts`, `agency.permissions.ts`, `payouts.state.ts`, `payouts.failure.ts` and `earnings-certificate.pdf.tsx` go to `utils/`.
   - `admin-redis.ts` becomes `schemas/admin.redis.schema.ts`.
   - `freelancer.agency-identity.ts` is renamed `services/freelancer.agency-identity.service.ts`.
   - `contracts.state.repository.ts` goes to `repositories/`.
5. **Layer and import rules are unchanged.** A module is still identified by the first segment after `modules/`; subfolders are invisible to the boundary test. Other modules import only `<name>.public.ts`, which stays at the root.
6. **A partly migrated tree is valid.** Until the last stage a module is in the old or the new layout; every check accepts both and any mix between stages passes.

## Enforcement

Final patterns, flipped in stage S1 (table files) and S11 (the rest):

- Table files: `/^modules\/([^/]+)\/models\/\1\.model\.ts$/` in `table-files.ts`; `isLooseTableFile` and the `repository-sql` carve-out and schema-specifier checks follow it; `drizzle.config.ts` globs `./src/modules/*/models/*.model.ts`.
- Controller restriction: the eslint block and `import-boundaries.test.ts` forbid controllers and routes from importing `models/` or the database. In S0 the boundary regex already accepts an optional `controllers/` segment.
- `table-files.test.ts` must fail on a root-level `<name>.schema.ts`; this is the proof that the old layout is rejected.
- `no-explicit-any: error` paths and the `payoutTotalsFiles` entries in `vitest.config.ts` gain the new paths in S0 and lose the old ones in S11. A `files` entry that matches nothing is harmless.

## Migration

No behavior, SQL, type or export changes, and no new dependency; each stage is proven by `hash-proof` (moved files identical except relative specifiers), `stale-specifiers` (every relative import and `vi.mock` resolves), unchanged test counts per file, an unchanged OpenAPI sha and drizzle reporting "No schema changes".

| Stage    | Scope                                                                                                                          |
| -------- | ------------------------------------------------------------------------------------------------------------------------------ |
| S0       | Foundation: transitional edits, this ADR, the stage skill, agent docs. No file moves.                                          |
| S1       | All 13 table files to `models/`; table-file patterns, eslint controller regex and drizzle glob go straight to their final form |
| S2       | auth                                                                                                                           |
| S3       | client, identity, connects                                                                                                     |
| S4       | jobs, payouts                                                                                                                  |
| S5       | freelancer                                                                                                                     |
| S6a, S6b | agency (source, then tests)                                                                                                    |
| S7a, S7b | messaging (source, then tests)                                                                                                 |
| S8       | meetings, notifications                                                                                                        |
| S9       | proposals, admin                                                                                                               |
| S10      | contracts                                                                                                                      |
| S11      | Tighten and document: remaining final patterns and fixtures, old paths removed, this ADR accepted, superseded marks added      |

## Supersedes

- ADR 0013 section 1 (module file list) and section 5 (suffix vocabulary): the folder rule above applies; `.model` is drizzle, `.schema` is zod.
- ADR 0014 section 1 (flat unless a threshold is met) and section 9 (`<name>.schema.ts`, glob `./src/modules/*/*.schema.ts`): every module has the same folder set, tables are `models/<name>.model.ts`.
- ADR 0015 section 1 carve-outs (`*.schema.ts` becomes `*.model.ts`) and section 5 (`auth.middleware.ts` path).

## Consequences

- Every relative specifier in a moved file gains a directory level; about 885 module specifiers and 46 inbound ones are rewritten across the stages.
- During the transition window both layouts are accepted by the architecture tests, the eslint blocks and the drizzle config.
- CodeQL `paths-ignore` needs no change: files in module `tests/` match `**/*.test.ts`.
