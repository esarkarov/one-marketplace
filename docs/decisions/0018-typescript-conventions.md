# 0018: TypeScript conventions

Status: accepted.

## Context

`services/api` mixed `type X = { ... }` and `interface X { ... }` for object shapes with no rule, and `DbExecutor` lived in `database/db-executor.ts`, a file named after one type.

## Decision

1. **Interface or type.** Use `interface` for object contracts, DTOs, configuration objects and extensible object structures. Use `type` for unions, intersections, primitive aliases, function signatures, mapped and conditional types, utility compositions (`Pick`, `Omit`, `Partial`) and `z.infer`, `typeof` and `$inferSelect` aliases.
2. **Enforcement.** `@typescript-eslint/consistent-type-definitions: ["error", "interface"]` applies to `src/**/*.ts`, tests included. It flags only `type X = { ... }` object literals. A declaration that must stay a `type` (for example an object type assigned to an index-signature parameter, because interfaces have no implicit index signature) takes the narrowest `eslint-disable-next-line` with a one-line reason. No such case exists today.
3. **What it does not touch.** Unions, intersections, aliases of other types, function types, mapped and conditional types and zod or drizzle inferred aliases stay `type`. Existing `interface` declarations are unchanged. The conversion changes only the declaration keyword form: no property, optionality, readonly or generic parameter changed.
4. **DbExecutor.** `DbExecutor` lives in `src/database/database.types.ts` (renamed from `db-executor.ts`, same exported name) and is imported with `import type`. Database-specific types are declared in `database/`, never in a module, unless derived from that module's own tables.
5. **Strictness.** `strict` stays on. New code does not add explicit `any` (an error in `shared/`, `config/`, `infrastructure/`, `bootstrap/`, `routes/`, `types/`, `middleware/`, `jobs/` and the database types, a warning elsewhere), non-null assertions or `as` assertions that narrow without a check, and does not use `@ts-ignore`. A `@ts-expect-error` needs a one-line reason.

## Consequences

- No runtime, SQL, OpenAPI or schema change.
- ADRs 0013 and 0014 keep their text and name `db-executor.ts`; read them with this ADR.
