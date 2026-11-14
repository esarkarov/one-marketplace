# 0016: Module folder layout

Status: accepted. Supersedes parts of ADR 0013, ADR 0014 and ADR 0015 (list below).

## Context

After ADR 0014 the 14 modules under `services/api/src/modules/` (198 files) were flat, except `contracts`, which split services and tests into folders. A module of 20 files mixed controllers, services, repositories, zod schemas, responses, tables and tests in one directory, and ADR 0014 section 1 made the shape depend on a size threshold. One folder set for every module makes a file's role visible from its path and removes the threshold.

## Decision

1. **Folder set.** Every module is `modules/<name>/` with `controllers/`, `services/`, `repositories/`, `models/`, `schemas/`, `responses/`, `middleware/` and `tests/`, plus `types/`, `constants/` and `utils/`. Folders exist only when they hold files, so `payouts` has no `controllers/` and `identity` has no `models/`; empty folders are not created. Folders are not nested.
2. **Module root.** The root keeps `<name>.route.ts`, `<name>.public.ts` and the entry points wired by `bootstrap/` (`<name>.socket.ts`, `<name>.cron.ts`, `<name>.consumer.ts`), for the same reason `route` stays: `routes/` and `bootstrap/` assemble them. Nothing else sits at the root.
3. **Naming.** `models/<name>.model.ts` holds the module's Drizzle tables and enums and is the only file in `models/`. `schemas/<x>.schema.ts` holds zod request schemas (`schemas/admin.redis.schema.ts` holds the admin Redis key schemas). `responses/<x>.responses.ts` holds zod response schemas. `.model` means drizzle and `.schema` means zod. Tests live in `tests/` and keep their `<subject>` suffix names (ADR 0014 section 4).
4. **Role suffixes and folders.** A file with a role suffix lives in that role's folder: `*.controller.ts` in `controllers/`, `*.service.ts` in `services/`, `*.repository.ts` in `repositories/`, `*.model.ts` in `models/`, `*.schema.ts` in `schemas/`, `*.responses.ts` in `responses/`, `*.middleware.ts` in `middleware/`, `*.types.ts` in `types/`, `*.constants.ts` in `constants/`, `*.test.ts` in `tests/`. Each folder holds only its own file kind, with two allowances written here and nowhere else:
   - `services/` also holds `*.sse.ts` (`notifications.sse.ts`, the server-sent-events hub the notification service uses).
   - `utils/` holds any `.ts` or `.tsx` helper without a role suffix (`agency.errors.ts`, `agency.permissions.ts`, `payouts.state.ts`, `payouts.failure.ts`, `earnings-certificate.pdf.tsx`).
5. **Renames at the move.** `freelancer.agency-identity.ts` is `services/freelancer.agency-identity.service.ts`; `admin-redis.ts` is `schemas/admin.redis.schema.ts`; `contracts.state.repository.ts` is in `repositories/`.
6. **Layer and import rules are unchanged.** A module is still identified by the first segment after `modules/`; subfolders are invisible to the boundary test. Other modules import only `<name>.public.ts`, which stays at the root.

## Enforcement

- `src/test/architecture/module-layout.test.ts` (rules in `module-layout.ts`) fails on any file or folder that breaks section 1, 2, 3 or 4, with no exemption list: an unknown or nested folder, a root file that is not a route, public or entry point of the module, a role-suffixed file in the wrong folder, a test outside `tests/`, a file in a role folder that does not match its kind, and anything but `<name>.model.ts` in `models/`.
- Table files: `/^modules\/([^/]+)\/models\/\1\.model\.ts$/` in `table-files.ts`; `isLooseTableFile` and the `repository-sql` carve-out and schema-specifier checks follow it; `drizzle.config.ts` globs `./src/modules/*/models/*.model.ts`. `table-files.test.ts` rejects a root-level `<name>.schema.ts`.
- Controller restriction: the eslint block and `import-boundaries.test.ts` forbid `controllers/*.controller.ts` and root `*.route.ts` files from importing `models/`, `.model` files or the database.
- `no-explicit-any: error` paths in `eslint.config.mjs` and the `payoutTotalsFiles` entries in `vitest.config.ts` name the `tests/` and folder paths.

## Migration

The migration ran in stages S0 to S11 with no behavior, SQL, type or export changes and no new dependency. Each stage was proven by `hash-proof` (moved files identical except relative specifiers), `stale-specifiers` (every relative import and `vi.mock` resolves), unchanged test counts per file, an unchanged OpenAPI sha and drizzle reporting "No schema changes". S11 removed the transitional patterns and added the layout test.

## Supersedes

- ADR 0013 section 1 (module file list) and section 5 (suffix vocabulary): the folder rule above applies; `.model` is drizzle, `.schema` is zod.
- ADR 0014 section 1 (flat unless a threshold is met) and section 9 (`<name>.schema.ts`, glob `./src/modules/*/*.schema.ts`): every module has the same folder set, tables are `models/<name>.model.ts`. Section 4 keeps its vocabulary; tests are in `tests/`.
- ADR 0015 section 1 carve-outs (`*.schema.ts` becomes `*.model.ts`) and section 5 (`auth.middleware.ts` is `modules/auth/middleware/auth.middleware.ts`).

## Consequences

- A file's role is visible from its path and a new module follows one recipe (`docs/adding-an-api-module.md`).
- Every relative specifier in a moved file gained a directory level; about 885 module specifiers and 46 inbound ones were rewritten across the stages.
- CodeQL `paths-ignore` needs no change: files in module `tests/` match `**/*.test.ts`.
