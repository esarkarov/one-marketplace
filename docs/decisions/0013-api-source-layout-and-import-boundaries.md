# 0013: API source layout and import boundaries

Status: accepted. Section 1 is partly superseded by ADR 0014 (`schema.ts` as one file, the `shared/` areas, the `test/` layout, `app-middleware/`); the rest stands.

Superseded in part by ADR 0017: a module's public API is `modules/<name>/index.ts`, not `<name>.public.ts`.

This amends the rule "third-party clients are created only in `src/config/`" (ADR 0001, `AGENTS.md`, `docs/architecture.md`). ADRs 0011 and 0012 are accepted and keep their historical paths (`src/utils`, `src/middleware`, ...); this ADR supersedes those paths. The living docs are updated with the migration phases below.

## Context

`services/api/src` is flat by technical role: `config` holds third-party clients next to env and logger, `utils` is a grab bag, `events` holds RabbitMQ infrastructure, and `middleware` mixes generic middleware with domain ones (`connects.middleware.ts`, `admin-session.middleware.ts`). Modules import each other's controllers and services.

The architecture test `src/test/architecture/import-boundaries.test.ts` measured the current state: 8 module cycles (the cycle check is `it.fails` until they are gone) and 26 module-to-module plus 3 non-test shared-to-module exceptions in `boundary-exceptions.ts`. Main causes: the `requireClient` and `requireFreelancer` guards live in the proposals and freelancer controllers; messaging's route wires the meetings controller; services read each other's services (agency, freelancer, connects, messaging); `contracts` and `proposals` emit through `messaging.socket.ts`; the events consumer imports the notifications SSE hub.

Constraints: this stays a modular monolith (ADR 0001), not microservices. No wholesale Clean Architecture, DDD or hexagonal layering, no repositories, no barrel files, no new dependencies.

## Decision

### 1. Target layout under `services/api/src`

> Superseded by ADR 0016: a module has the folder set `controllers/`, `services/`, `repositories/`, `models/`, `schemas/`, `responses/`, `middleware/`, `tests/` (plus `types/`, `constants/`, `utils/`).

- `server.ts` (entry) and `app.ts` (express factory).
- `bootstrap/`: ordered start and stop of infrastructure and of the module-owned workers, and readiness. `payouts.cron.ts` and `messaging.socket.ts` stay in their modules; bootstrap only runs their lifecycle. No `workers/` or `realtime/` folders.
- `config/`: validated env, constants, cors, logger, webhooks.
- `infrastructure/`: one folder per third-party service, see "Infrastructure layout" below. The notifications consumer lives in `modules/notifications/notifications.consumer.ts`.
- `shared/`:
  - `http/`: api-error, async-handler, generic middleware, and the auth and role guards (`requireClient`, `requireFreelancer`).
  - `validation/`: common, response, money and search schemas, and `validation-limits.ts`.
  - `money/`: `money.ts`.
  - `utils/`: uuid-v5, sanitize-log, email, attachments, portfolio-images. Superseded by ADR 0014.
- `database/`: Drizzle schema, client, database types (`database.types.ts`, ADR 0018). It stays outside `infrastructure/` because `/db-change`, the database agent, `drizzle.config.ts` and the README target `src/database`, and because the schema is the persistence contract owned by all modules, not a client. `schema.ts` stays one file (1283 lines, 28 tables): splitting it risks the drizzle-kit "No schema changes" result and has no boundary benefit. Superseded by ADR 0014 section 9: tables live in the owning modules as `<name>.schema.ts`, and `database/` keeps the client, database types (`database.types.ts`, ADR 0018) and `pg-errors.ts`.
- `modules/<name>/`: `route`, `controller`, `service`, `schemas`, `responses`, `types`, and optionally `<name>.public.ts`.
- `routes/` (assembly and the route registries), `openapi/`, `types/`, `test/` (helpers and the architecture test). `test/` layout superseded by ADR 0014.

### 2. Third-party clients

One file per third-party client under `src/infrastructure/`, none created anywhere else. An eslint `no-restricted-imports` rule forbids importing the client packages (stripe, clerk, daily, imagekit, ioredis or redis, amqplib and amqp-connection-manager) outside `src/infrastructure/`. `config/` keeps configuration only.

### Infrastructure layout

`src/infrastructure/` has one folder per third-party service, three shared folders, and no loose files:

- `auth/`: `clerk.client.ts` (Clerk client and `verifyToken`).
- `cache/`: `redis.client.ts` and `account-auth.cache.ts`.
- `events/`: `rabbitmq.client.ts`, `notification.publisher.ts`, `notification.envelope.ts` and `notification.topology.ts`.
- `payments/`: `stripe.client.ts`.
- `storage/`: `image-kit.client.ts`.
- `video/`: `daily.client.ts`.
- `constants/`: constants shared across services, with an `index.ts` barrel; other files are `*.constants.ts`.
- `types/`: types shared across services, with an `index.ts` barrel; other files are `*.types.ts`.
- `utils/`: `*.utils.ts` (`lazy-client.utils.ts`, `createLazyClient`, used by the Clerk and Stripe clients).

Every third-party client file is `<service>.client.ts` inside its service folder, and only `.client.ts` files import a client package (type imports are exempt; use `import type` for type-only imports). `index.ts` is allowed only in `constants/` and `types/`, which are imported as `../constants/index.js` and `../types/index.js`. Folders are flat. Tests sit next to their code. There are no `helpers`, `common` or `misc` files. `src/test/architecture/infrastructure-layout.test.ts` enforces this without exemptions. Upload logic (`upload-documents`) is not infrastructure and lives in `shared/uploads`.

### 3. Dependency direction

- `config`, `infrastructure`, `shared`, `database` and `types` never import `modules` (documented exceptions only).
- Modules import `config`, `infrastructure`, `shared` and `database`.
- `bootstrap`, `routes` and `openapi` may import modules.
- Modules talk to each other only through a small `<name>.public.ts`, never controllers or internals. A public file exists only for a module other modules import: today `agency`, `auth`, `connects`, `freelancer`, `jobs` and `messaging`. Extend one only when a real caller needs it.
- No cycles, ever. A cycle is never an entry in the exception list.

Cuts that remove today's edges (derived from the real import graph in `src/modules`):

| Edge today                                                                                              | Resolution                                                                                                                                                                |
| ------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `requireClient` (from proposals), `requireFreelancer` (from freelancer) in 5 controllers                | move code down: `shared/http`                                                                                                                                             |
| `messaging.route` imports meetings controller, schemas, responses                                       | move code up: meetings routes wired in `routes/` assembly                                                                                                                 |
| `openapi/build-spec` imports the admin session middleware                                               | move code down: `shared/http`                                                                                                                                             |
| `events/consumer` imports the notifications SSE hub                                                     | move code down: the hub goes to `infrastructure`                                                                                                                          |
| agency, freelancer, messaging, contracts, notifications, proposals read `agency.service` member lookups | public surface: `agency.public.ts` (`getAgencyIdForMember` and similar)                                                                                                   |
| agency and contracts read `freelancer.service` (`getJSSContribution`, `getMatchedJobPostsBySkills`)     | public surface: `freelancer.public.ts`                                                                                                                                    |
| agency, freelancer read `connects.service` (`addAgencyConnects`, `addConnects`)                         | public surface: `connects.public.ts`                                                                                                                                      |
| contracts and proposals call `emitConversationUpdate` from `messaging.socket`; meetings uses messaging  | public surface: `messaging.public.ts`                                                                                                                                     |
| `freelancer.service` reads agency identity for a member                                                 | move code down: `getAgencyIdentityForMember` is in `shared/utils/agency-identity.ts`                                                                                      |
| `agency.controller` calls `proposals.service`; `proposals.service` calls agency                         | invert the reverse edge: the three agency proposal handlers live in `proposals.controller` and `proposals.route.ts` exports `agencyProposalsRouter`, mounted at `/agency` |
| `agency.controller` calls `connects` and `freelancer` services                                          | public surface (above)                                                                                                                                                    |

Module layers (enforced by the architecture test). A module may import only a strictly lower layer, never one in its own layer, and only through the other module's `<name>.public.ts`.

| Layer | Modules                                          | May import                          |
| ----- | ------------------------------------------------ | ----------------------------------- |
| 0     | auth                                             | no module                           |
| 1     | admin, client, identity, jobs, payouts, connects | auth                                |
| 2     | freelancer                                       | auth, connects                      |
| 3     | agency                                           | auth, connects, freelancer          |
| 4     | messaging                                        | auth, agency                        |
| 5     | meetings, notifications, proposals               | auth, agency, messaging, connects   |
| 6     | contracts                                        | auth, agency, freelancer, messaging |

Renumbered by ADR 0014 section 10: auth became its own bottom layer and every other module moved up by one, so client, connects and identity can call `auth.public.ts`. Client, connects, identity, freelancer and contracts import `auth.public.ts`; the "May import" column lists what a layer is allowed to import.

Layer 0 modules import no module. The table matched the real graph, so it did not change in Phase C. To change an order, change this table in the same PR as the code and the test.

### 4. Table ownership

Rule: one owner per table. Other modules may read a table they do not own but never write it. Read access across modules stays as documented exceptions; there are no repositories. `payouts` reads other modules' tables by design (ADR 0005).

| Owner         | Tables                                                                                                                    |
| ------------- | ------------------------------------------------------------------------------------------------------------------------- |
| auth          | `accounts`                                                                                                                |
| client        | `client_metadata`                                                                                                         |
| freelancer    | `freelancer_metadata`, `freelancer_portfolios`                                                                            |
| jobs          | `job_posts`, `freelancer_saved_job_posts`                                                                                 |
| connects      | `connects`, `connects_history`, `connects_purchase_history`                                                               |
| notifications | `notifications`                                                                                                           |
| proposals     | `proposals`                                                                                                               |
| messaging     | `conversations`, `messages`, `conversation_participants`, `message_attachments`                                           |
| meetings      | `meetings`                                                                                                                |
| contracts     | `contracts`, `contract_milestones`, `freelancer_earning`, `agency_earning`, `earning_history`, `client_spents`, `reviews` |
| payouts       | `payout_history`                                                                                                          |
| agency        | `agency_metadata`, `agency_portfolios`, `agency_members`, `agency_invitations`                                            |

Cross-module table access, reads and writes, is no longer listed here. Superseded by ADR 0014 section 9: the list is `services/api/src/test/architecture/table-access-allowlist.ts` (owners in `table-ownership.ts`), enforced by `table-access.test.ts`. Each write carries a reason and is known debt; it should move behind the owning module's public surface or an event, per module and with a test, never as part of the layout move. `payouts` reads other tables by design (ADR 0005).

### 5. Naming

> Superseded by ADR 0016: the suffix vocabulary now maps to folders, `.schema` is zod and `.model` is drizzle.

Derived from existing practice:

- Folders and files are kebab-case with a role suffix: `.route`, `.controller`, `.service`, `.schemas`, `.responses`, `.types`, `.middleware`, `.public`, `.cron`, `.socket`, `.test` (and `.integration.test`, `.contract.test`).
- Functions and variables are camelCase; types, interfaces and classes are PascalCase; interfaces have no `I` prefix; module-level constants are `SCREAMING_SNAKE_CASE` when they are fixed configuration and camelCase otherwise.
- Zod schemas are camelCase values ending in `Schema` or named for the input (`createJobBody`); inferred DTO types are PascalCase via `z.infer`.
- Database tables and columns stay snake_case, as the schema has them.

Outliers renamed in Phase D:

- `freelancer/@types.ts` to `freelancer.types.ts`
- `notifications/notification.sse.ts` to `notifications.sse.ts`
- `payouts/payout-state.ts` and `payout-failure.ts` to `payouts.state.ts` and `payouts.failure.ts`
- `config/imageKit.ts` to `infrastructure/storage/image-kit.client.ts`
- `middleware/connects.middleware.ts` moves into the connects module

### 6. Enforcement

- The architecture test `src/test/architecture/import-boundaries.test.ts` checks module boundaries, shared-to-module direction, controller-to-database, stale exceptions and cycles. It is extended with the layer table and the new directory names.
- eslint `no-restricted-imports` for third-party clients (section 2) and for deep imports into another module's files.
- The exception list lives in `src/test/architecture/boundary-exceptions.ts` and is not copied here. It is empty after Phase C: no import exceptions remain and the cycle test is a normal `it`. Table reads of another module's tables (section 4) are not import edges and are not listed there.

### Phases

- A: this ADR, living docs, and the architecture test as a measuring tool (done).
- B: move guards, SSE hub, admin session middleware and meetings wiring; create `shared/`, `infrastructure/`, `bootstrap/`; add the eslint rule.
- C: add the four `*.public.ts` files, move service reads down, invert reverse edges, enforce the layer table and no cycles (done).
- D: naming renames (done).
- E: delete resolved exceptions, update `AGENTS.md`, `docs/architecture.md` and the READMEs to the new paths.

### Shared and middleware layout

Supersedes the `shared/http` grouping in ADR 0014 section 2. `src/middleware/` has one folder per middleware, holding the middleware and its test: `error/`, `not-found/`, `request-id/`, `http-logger/`, `validate/`, `json-body/` (parser and large-body route config), `rate-limit/` and `auth/` (admin-session guard, `role-guards.middleware.ts`). `constants/`, `types/` and `utils/` hold extracted owner-named files (`*.constants.ts`, `*.types.ts`, `*.utils.ts`, including `async-handler.utils.ts`). Modules, bootstrap and infrastructure import `middleware/`; it imports `shared/`, `infrastructure/` and `config/`, never modules. The admin-session guard stays there because `openapi/builders/build-operation.ts` also reads it.

`src/shared/` holds `errors/`, `responses/` (`api-envelope.responses.ts`, `scalar.responses.ts`), `validation/` (`schemas/`, `constants/`, `utils/`), `ids/`, `logging/`, `money/` and `uploads/` (`constants/`, `types/`, `utils/`). There is no `shared/http`. Limit objects belong to the module that uses them (`modules/<m>/constants/<m>.constants.ts`); `COMMON_LIMITS`, `JOB_LIMITS` (jobs, agency, freelancer) and `MESSAGING_LIMITS` (jobs, messaging) stay in `shared/validation/constants/` because several modules import them. `src/test/architecture/shared-layout.test.ts` enforces the folders without exemptions.

## Routing

`src/routes/index.ts` only imports module routers and registers them under their prefixes, in a fixed order. A module-specific router is exported from that module's `<name>.route.ts`, as `agencyProposalsRouter` is from `proposals`. `/health` and `/ready` belong to the `health` module (layer 0). Route introspection and the contract allowlist live in `src/openapi/`; the validation allowlist and the route checks live in `src/test/architecture/routing/`.

## Lifecycle hardening (Stage 11)

Items 1 to 5 are fixed. They change process startup and shutdown only: no request path, API contract, OpenAPI output or schema changed.

1. Fixed. `payouts.cron.ts` tracks the in-flight run and exposes `waitForPayoutRun`. Shutdown stops the cron (no new runs), waits for a run in flight for at most `PAYOUT_DRAIN_TIMEOUT_MS` (`SHUTDOWN_TIMEOUT_MS` minus two connection grace periods, so it ends before the forced exit), logs a warning if it times out and continues, and only then runs the later steps, ending with `pool.end()`.
2. Fixed. `bootstrap/crash-handlers.ts` registers `unhandledRejection` and `uncaughtException` once, from `server.ts` only (never on import). Each logs `system.crash` at fatal level with `errorLogAttributes`, starts the same graceful `shutdown` and exits non-zero. A crash during shutdown is logged and marks the exit non-zero without starting a second shutdown; the existing forced-exit timer ends the process.
3. Fixed. `start.ts` waits for `listen` to succeed. A listen error (`EADDRINUSE` and similar) rejects `start`, so `handleStartupFailure` logs and exits 1; an error after listening goes to the crash handler as `serverError`. The notification consumer, messaging socket and payout cron start only after the server is listening, in that order.
4. Fixed. `start.ts` calls `pingDatabase` (health module, exported through `modules/health/index.ts`) before Redis, RabbitMQ or listening; a failure follows the startup failure path and exits 1 without starting cron or sockets.
5. Fixed. `middleware/utils/sse-streams.utils.ts` registers open SSE responses (the notifications stream; `/admin/logs/stream` never streams and answers 503); shutdown stops listening, sends `retry: 1000` and `event: shutdown` to every stream and ends it before the payout drain and the grace period, and new SSE requests get 503 with `Retry-After: 1`.

The `AGENTS.md` wording on RabbitMQ (optional, enabled by `RABBITMQ_URL`) is correct (ADR 0004).

## Consequences

- Dependency direction is checked in CI instead of by review, and cycles cannot return.
- Third-party clients get one clear home and a lint rule instead of a convention.
- `bootstrap/` makes the startup and shutdown order visible and testable, which Stage 11 needs.
- Moving files breaks every import path in one pass; it is mechanical but touches most of the tree. Phases B to D are separate PRs so each diff stays reviewable.
- Moving files must not change generated artifacts: `docs/api/openapi.json` stays identical, and `document.ts` reads `src/routes/index.ts` as text, so the route assembly path must be handled in Phase B.
- Public surfaces add small indirection (plain re-exports of the functions other modules call). They stay minimal and are created only for modules that others import.
- Table-write ownership is enforced (ADR 0014 sections 9 and 11); cross-module writes moved to owner functions and the allowlist has no writes.
- The layer table is a proposal derived from today's graph. Phase C may adjust it, in the same PR as the code.
- Dependency direction on `database/` and `types/` is checked, but a shared-table read is still allowed; it is not a boundary violation under this ADR.

## Clarification (2026-11-19)

Table definition files (`modules/<name>/models/<name>.model.ts`) are exempt from the module-boundary, module-layer and module-cycle rules in `import-boundaries.test.ts` (`isTableFile`), so a repository may import another module's table file whatever the layers. Cross-module table reads are governed by `table-access-allowlist.ts` and `table-access.test.ts` (ADR 0014 sections 9 and 11), which also fail any cross-module write. No rule changed; this records what the test already does.
