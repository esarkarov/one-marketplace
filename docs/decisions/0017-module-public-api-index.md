# 0017: A module's public API is `index.ts`

Status: accepted. Supersedes the `<name>.public.ts` convention of ADR 0013 and its mentions in ADR 0014, ADR 0015 and ADR 0016.

## Context

ADR 0013 made `modules/<name>/<name>.public.ts` the only file other modules may import. The file name repeated the module name and sat beside `<name>.route.ts` and the entry points. The folder-layout work (ADR 0016) left it as the one root file that existed only as an import target.

## Decision

1. **Name.** The cross-module public API of a module is `modules/<name>/index.ts`. It holds re-exports only, with the same content as the former `<name>.public.ts`.
2. **When it exists.** A module has an `index.ts` only if another module imports it today: agency, auth, connects, freelancer, health, jobs, messaging, proposals. No empty files.
3. **Cross-module imports.** An import from another module must resolve to exactly `modules/<name>/index.ts` (`import-boundaries.test.ts`, rule `module-boundary`). Layer rules, table ownership and the empty exception list are unchanged.
4. **No barrel self-import.** No file inside `modules/<name>/`, tests included, may import `modules/<name>/index.ts`; it imports the underlying file (`import-boundaries.test.ts`, rule `module-self-import`, no exceptions).
5. **Module root.** `module-layout.test.ts` allows `index.ts`, `<name>.route.ts`, `<name>.socket.ts`, `<name>.cron.ts` and `<name>.consumer.ts` at the root; a `<name>.public.ts` fails.

## Consequences

- Pure rename plus specifier rewrite: no behavior, SQL, type or export change. The OpenAPI contract and the schema are unchanged.
- ADRs 0013 to 0016 keep their text and name `.public.ts`; read them with this ADR.
