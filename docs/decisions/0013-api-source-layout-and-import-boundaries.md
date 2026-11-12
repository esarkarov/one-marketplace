# 0013: API source layout and import boundaries

Status: accepted. Section 1 is partly superseded by ADR 0014 (`schema.ts` as one file, the `shared/` areas, the `test/` layout, `app-middleware/`); the rest stands.

This amends the rule "third-party clients are created only in `src/config/`" (ADR 0001, `AGENTS.md`, `docs/architecture.md`). ADRs 0011 and 0012 are accepted and keep their historical paths (`src/utils`, `src/middleware`, ...); this ADR supersedes those paths. The living docs are updated with the migration phases below.

## Context

`services/api/src` is flat by technical role: `config` holds third-party clients next to env and logger, `utils` is a grab bag, `events` holds RabbitMQ infrastructure, and `middleware` mixes generic middleware with domain ones (`connects.middleware.ts`, `admin-session.middleware.ts`). Modules import each other's controllers and services.

The architecture test `src/test/architecture/import-boundaries.test.ts` measured the current state: 8 module cycles (the cycle check is `it.fails` until they are gone) and 26 module-to-module plus 3 non-test shared-to-module exceptions in `boundary-exceptions.ts`. Main causes: the `requireClient` and `requireFreelancer` guards live in the proposals and freelancer controllers; messaging's route wires the meetings controller; services read each other's services (agency, freelancer, connects, messaging); `contracts` and `proposals` emit through `messaging.socket.ts`; the events consumer imports the notifications SSE hub.

Constraints: this stays a modular monolith (ADR 0001), not microservices. No wholesale Clean Architecture, DDD or hexagonal layering, no repositories, no barrel files, no new dependencies.

## Decision

### 1. Target layout under `services/api/src`

- `server.ts` (entry) and `app.ts` (express factory).
- `bootstrap/`: ordered start and stop of infrastructure and of the module-owned workers, and readiness. `payouts.cron.ts` and `messaging.socket.ts` stay in their modules; bootstrap only runs their lifecycle. No `workers/` or `realtime/` folders.
- `config/`: validated env, constants, cors, logger, webhooks.
- `infrastructure/`: one file per third-party client or adapter: redis, rabbitmq, `events/` (envelope, topology, publisher, legacy-v1; the consumer lives in `modules/notifications/notifications.consumer.ts`), stripe, clerk, daily, image-kit, upload-documents, account-auth-cache.
- `shared/`:
  - `http/`: api-error, async-handler, generic middleware, and the auth and role guards (`requireClient`, `requireFreelancer`).
  - `validation/`: common, response, money and search schemas, and `validation-limits.ts`.
  - `money/`: `money.ts`.
  - `utils/`: uuid-v5, sanitize-log, email, attachments, portfolio-images. Superseded by ADR 0014.
- `database/`: Drizzle schema, client, db-executor. It stays outside `infrastructure/` because `/db-change`, the database agent, `drizzle.config.ts` and the README target `src/database`, and because the schema is the persistence contract owned by all modules, not a client. `schema.ts` stays one file (1283 lines, 28 tables): splitting it risks the drizzle-kit "No schema changes" result and has no boundary benefit. Superseded by ADR 0014: the schema is split by domain behind a re-export.
- `modules/<name>/`: `route`, `controller`, `service`, `schemas`, `responses`, `types`, and optionally `<name>.public.ts`.
- `routes/` (assembly and the route registries), `openapi/`, `types/`, `test/` (helpers and the architecture test). `test/` layout superseded by ADR 0014.

### 2. Third-party clients

One file per third-party client under `src/infrastructure/`, none created anywhere else. An eslint `no-restricted-imports` rule forbids importing the client packages (stripe, clerk, daily, imagekit, ioredis or redis, amqplib and amqp-connection-manager) outside `src/infrastructure/`. `config/` keeps configuration only.

### 3. Dependency direction

- `config`, `infrastructure`, `shared`, `database` and `types` never import `modules` (documented exceptions only).
- Modules import `config`, `infrastructure`, `shared` and `database`.
- `bootstrap`, `routes` and `openapi` may import modules.
- Modules talk to each other only through a small `<name>.public.ts`, never controllers or internals. A public file exists only for a module other modules import: today `agency`, `connects`, `freelancer` and `messaging`. Extend one only when a real caller needs it.
- No cycles, ever. A cycle is never an entry in the exception list.

Cuts that remove today's edges (derived from the real import graph in `src/modules`):

| Edge today                                                                                              | Resolution                                                                                                                                                 |
| ------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `requireClient` (from proposals), `requireFreelancer` (from freelancer) in 5 controllers                | move code down: `shared/http`                                                                                                                              |
| `messaging.route` imports meetings controller, schemas, responses                                       | move code up: meetings routes wired in `routes/` assembly                                                                                                  |
| `openapi/build-spec` imports the admin session middleware                                               | move code down: `shared/http`                                                                                                                              |
| `events/consumer` imports the notifications SSE hub                                                     | move code down: the hub goes to `infrastructure`                                                                                                           |
| agency, freelancer, messaging, contracts, notifications, proposals read `agency.service` member lookups | public surface: `agency.public.ts` (`getAgencyIdForMember` and similar)                                                                                    |
| agency and contracts read `freelancer.service` (`getJSSContribution`, `getMatchedJobPostsBySkills`)     | public surface: `freelancer.public.ts`                                                                                                                     |
| agency, freelancer read `connects.service` (`addAgencyConnects`, `addConnects`)                         | public surface: `connects.public.ts`                                                                                                                       |
| contracts and proposals call `emitConversationUpdate` from `messaging.socket`; meetings uses messaging  | public surface: `messaging.public.ts`                                                                                                                      |
| `freelancer.service` reads agency identity for a member                                                 | move code down: `getAgencyIdentityForMember` is in `shared/utils/agency-identity.ts`                                                                       |
| `agency.controller` calls `proposals.service`; `proposals.service` calls agency                         | invert the reverse edge: the three agency proposal handlers live in `proposals.controller` and `routes/agency-proposals.route.ts` mounts them at `/agency` |
| `agency.controller` calls `connects` and `freelancer` services                                          | public surface (above)                                                                                                                                     |

Module layers (enforced by the architecture test). A module may import only a strictly lower layer, never one in its own layer, and only through the other module's `<name>.public.ts`.

| Layer | Modules                                                | May import                    |
| ----- | ------------------------------------------------------ | ----------------------------- |
| 0     | admin, auth, client, identity, jobs, payouts, connects | no module                     |
| 1     | freelancer                                             | connects                      |
| 2     | agency                                                 | connects, freelancer          |
| 3     | messaging                                              | agency                        |
| 4     | meetings, notifications, proposals                     | agency, messaging, connects   |
| 5     | contracts                                              | agency, freelancer, messaging |

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

Cross-module writes that exist today, verified by Grep on `.insert`, `.update` and `.delete`. They are debt, not enforced automatically:

- proposals writes `connects`, `connects_history`, `conversations`, `conversation_participants` and `messages`.
- contracts writes `messages`, `conversations`, `conversation_participants` and `accounts`.
- freelancer, client, identity and connects write `accounts` (owner auth).
- the events consumer writes `notifications` (owner notifications).
- `payouts` writes only `payout_history`; its reads of other tables are the ADR 0005 exception.

Each should move behind the owning module's public surface or an event. Do that per module, with a test, never as part of the layout move.

### 5. Naming

Derived from existing practice:

- Folders and files are kebab-case with a role suffix: `.route`, `.controller`, `.service`, `.schemas`, `.responses`, `.types`, `.middleware`, `.public`, `.cron`, `.socket`, `.test` (and `.integration.test`, `.contract.test`).
- Functions and variables are camelCase; types, interfaces and classes are PascalCase; interfaces have no `I` prefix; module-level constants are `SCREAMING_SNAKE_CASE` when they are fixed configuration and camelCase otherwise.
- Zod schemas are camelCase values ending in `Schema` or named for the input (`createJobBody`); inferred DTO types are PascalCase via `z.infer`.
- Database tables and columns stay snake_case, as the schema has them.

Outliers renamed in Phase D:

- `freelancer/@types.ts` to `freelancer.types.ts`
- `notifications/notification.sse.ts` to `notifications.sse.ts`
- `payouts/payout-state.ts` and `payout-failure.ts` to `payouts.state.ts` and `payouts.failure.ts`
- `config/imageKit.ts` to `infrastructure/image-kit.ts`
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

## Findings reported, not fixed here

For the Stage 11 lifecycle hardening, in this order of priority:

1. `stopPayoutCron` does not wait for an in-flight `processDuePayouts` before `pool.end()` (do first).
2. No `unhandledRejection` or `uncaughtException` handler.
3. `server.listen` errors are unhandled, and the cron and socket start before `listen` succeeds.
4. The DB pool is not checked at startup.
5. SSE streams (notifications, admin) have no close function and are cut by `closeAllConnections` after 3 s.

The `AGENTS.md` wording on RabbitMQ (optional, enabled by `RABBITMQ_URL`) is correct (ADR 0004).

## Consequences

- Dependency direction is checked in CI instead of by review, and cycles cannot return.
- Third-party clients get one clear home and a lint rule instead of a convention.
- `bootstrap/` makes the startup and shutdown order visible and testable, which Stage 11 needs.
- Moving files breaks every import path in one pass; it is mechanical but touches most of the tree. Phases B to D are separate PRs so each diff stays reviewable.
- Moving files must not change generated artifacts: `docs/api/openapi.json` stays identical, and `document.ts` reads `src/routes/index.ts` as text, so the route assembly path must be handled in Phase B.
- Public surfaces add small indirection (plain re-exports of the functions other modules call). They stay minimal and are created only for modules that others import.
- Table-write ownership is documented but not enforced; cross-module writes remain debt until each is moved.
- The layer table is a proposal derived from today's graph. Phase C may adjust it, in the same PR as the code.
- Dependency direction on `database/` and `types/` is checked, but a shared-table read is still allowed; it is not a boundary violation under this ADR.
