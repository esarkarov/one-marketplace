# Backend slice checklist

- Imports: `@/` aliases with `.js`, no `../`; other modules only through their `index.ts`, only lower layers (ADR 0013, 0017, 0020). New module: add it to `moduleLayers` in `import-boundaries.test.ts` and the ADR 0013 layer table.
- SQL only in `repositories/*.repository.ts`; repositories take the executor first, return data, never throw `ApiError` (ADR 0015).
- Writes to another module's table: owner function in that module's `index.ts`. New read edges go into `table-access-allowlist.ts` with review.
- Multi-step writes: one transaction; guarded conditional UPDATE for status changes; lost race answers a coded 409 (ADR 0007). Batch claims: `WITH picked AS MATERIALIZED (...)` (ADR 0023).
- Notifications: must-not-lose kinds via `insertNotification(executor, ...)` in the transaction with `notificationEventId`, `pushStoredNotification(row)` after commit; the rest via `sendNotification`.
- Money: integer cents only; `splitFee`, `toSafeCents`, `moneyCents` from `shared/money/money.ts`.
- Route: `validate({ ...<route>Request, responses })`, `getValidated`, strict zod objects, `uuidParam`, limits in `constants/`, 2xx response schema, contract and validation tests.
- Ids in responses are public ids (`accounts.id`, agency id), never Clerk ids. Errors never leak 5xx internals.
- Vitest: a test that writes PAID payout rows or asserts on global counts or search page order goes into `payoutTotalsFiles` in `vitest.config.ts`.
- Env: new variable goes through `src/config/env.ts` validation and `docs/architecture.md` table; the owner edits `.env.example`.
