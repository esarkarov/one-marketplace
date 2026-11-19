# 0020: Import aliases (`@/`)

Status: accepted. Applies to `services/api` (`src` and `scripts`).

## Context

Cross-directory imports in `services/api` were parent-relative chains such as `../../../shared/errors/api-error.js`. They are hard to read and review, they break when a file moves, and every analyzer under `src/test/architecture` had to rebuild the target path from the importer's location.

## Decision

1. **Convention.** A cross-directory import uses `@/` mapped to `services/api/src/`, keeping the `.js` suffix: `@/modules/freelancer/index.js`, `@/shared/money/money.js`, `@/test/support/clerk-id-scan.js`. A same-directory import stays `./x.js`. A parent-relative import (`../`) is not allowed in `src` or `scripts`, and there is no exception file. This covers `import` and `export ... from`, `import()`, `typeof import()` types, and the paths given to `vi.mock`, `vi.doMock`, `vi.importActual`, `vi.importMock` and `importOriginal`. Filesystem paths that are not module specifiers (`new URL("../..", import.meta.url)`, asset paths) are unchanged.
2. **Why not `package.json` `imports`.** Node's `imports` field only accepts keys that start with `#`, so `@/` cannot be expressed there. `@/` is a build-time alias, resolved by each tool below.
3. **Per tool.**
   - `tsc` (TypeScript 7, `@typescript/native`): `compilerOptions.paths` `{ "@/*": ["./src/*"] }` in `tsconfig.json`, inherited by `tsconfig.build.json` and `tsconfig.scripts.json`. No `baseUrl`.
   - `tsx` (`dev`, `openapi:generate`, scripts): reads the tsconfig `paths`.
   - Vitest: `resolve.alias` in `vitest.config.ts` maps `/^@\//` to `src/`. The regular expression leaves scoped packages such as `@clerk/backend` alone. The projects extend it.
   - drizzle-kit: resolves `@/` in the `*.model.ts` files it loads, so there is no exception. `db:generate` answers "No schema changes", and `db:migrate` and `db:test:migrate` apply nothing new.
   - Build: `tsc` does not rewrite paths, so `pnpm build` runs `scripts/rewrite-dist-aliases.mjs` after it. The script rewrites every `@/...` specifier in `dist/**/*.js` and `*.d.ts` (static, export-from, side-effect and dynamic imports) to a relative specifier, leaves `node:` and package specifiers alone, then fails the build if any `@/` remains or any relative specifier in `dist` does not resolve to a file. `node scripts/rewrite-dist-aliases.mjs --check` runs only that check. It is plain Node with no dependencies. `src/test/tooling/rewrite-dist-aliases.test.ts` covers the rewrite and the check on temporary directories.
   - ESLint: `no-restricted-imports` bans `..` and `../**` in `src/**` and `scripts/**`. The controller and route blocks repeat that pattern because a later block replaces, not merges, the option.
4. **Guards.** `src/test/architecture/import-aliases.test.ts` fails on any parent-relative specifier of the kinds listed in point 1 and on any `@/` specifier that does not resolve to a file under `src`. The analyzers that resolve specifiers (`import-boundaries`, `table-access`, `table-files`) resolve `@/` through one `resolveImport` in `table-access.ts`, which still resolves `./` and `../` for fixtures. The analyzers that read specifier text (`repository-sql`, `repository-purity`, `infrastructure-layout`) match on path segments or package names and need no change.

## Consequences

- A moved file keeps its imports of other directories; only `./` imports change.
- Anything that runs the TypeScript sources outside tsc, tsx and Vitest, or runs `dist` before the rewrite step, cannot resolve `@/`. The build script always runs the rewrite, and CI and the start script use the built output.
- A new tool that loads `src` files must be given the alias or fail on the first `@/` import.
