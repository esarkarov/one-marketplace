# Frontend integration notes

Checklist for the five Next.js apps, which use mock data today and do not call the API yet. Every item was checked against [`api/openapi.json`](api/openapi.json) and the code; the OpenAPI document is the contract for shapes, this file lists what is easy to get wrong. Rules for API authors are in [`../services/api/AGENTS.md`](../services/api/AGENTS.md).

## Base, auth and limits

- Base path `/api/v1`, default port 4000. `GET /api/v1/health` is liveness; `GET /api/v1/ready` checks Postgres and Redis (503 if either is down). Swagger UI: `pnpm infra:up`, then `http://127.0.0.1:8081` (`SWAGGER_PORT`), see the [README](../README.md#api-documentation).
- Users sign in with Clerk; send the Clerk session token as `Authorization: Bearer <token>`. 79 operations need it (including `POST /auth/sign-up`). 12 are public: `GET /health`, `GET /ready`, `GET /jobs/public`, freelancer and agency search and public profile, `POST /admin/auth/login` and the four webhooks (server to server, never called by the apps). The 11 other admin operations use the admin session below.
- Every Clerk-authenticated operation except `POST /auth/sign-up` takes a required query parameter `role=client|freelancer`. Add `scope=agency` (default `default`) on the nine operations that list it (`GET /contracts/freelancer`, contract accept, decline, finish and milestone submit, `GET /conversations`, `GET /notifications`, `PATCH /notifications/read-all`, `GET /notifications/stream`) to act as the agency.
- Admin: `POST /admin/auth/login` returns `{ token, expiresAt }` (session lasts 2 hours); send it as `Authorization: Bearer <token>`. `GET /admin/logs/stream` also accepts `?token=`.
- Rate limits: 300 requests per 15 minutes globally (health, ready and webhooks exempt), 60 per minute on `GET /freelancer/search` and `GET /agency/search`, 10 sign-ups per hour, 20 failed admin logins per 15 minutes. The standard `RateLimit` headers are sent. An exceeded limit answers 429 with code `RATE_LIMITED`; back off and retry.
- Browser origins must be allowed by the API (`CLIENT_DASHBOARD`, `FREELANCER_DASHBOARD`, `AGENCY_DASHBOARD`, `ADMIN_DASHBOARD`); without them the local ports 3001 to 3004 are allowed outside production.
- Notifications stream (`GET /notifications/stream`, server-sent events) authenticates with the bearer header only; there is no token query parameter, so a native `EventSource` cannot call it. Use a fetch-based reader.
- Messaging uses Socket.IO. The handshake `auth` is `{ token, role, scope? }`; `scope: "agency"` joins the agency room.

## Response shape

- Success is `{ success: true, message, data }`. A single resource is `data`; a mutation with nothing to return has `data: null`.
- Offset lists return `data: { results, hasMore }`. `limit` defaults to 20 (1 to 100) and `offset` to 0 (0 to 10000). Cursor lists return `data: { results, nextCursor }` (`nextCursor` is `null` at the end); the messages list uses `cursor` and `limit` default 30, maximum 50.
- Every error is `{ success: false, message, code, requestId, errors? }`. Branch on `code`, show `message` for validation errors (`errors[]` holds `{ path, message }`), and log `requestId`. 5xx never carries internal detail.
- Dates are ISO 8601 strings.

## Naming and ids

- Fields are lowerCamelCase everywhere. Body and response enums are UPPER_SNAKE (`status`, `senderType`, `memberRole`, `counterpartyType`, ...). The exception is `role`, which stays lowercase `client|freelancer`.
- Money is integer cents in `*Cents` fields (`totalBudgetCents`, `hourlyRateCents`, `minBudgetCents`); never send dollars or floats.
- No Clerk id appears in any request or response. Public ids are `accounts.id` for clients and freelancers and the agency id for agencies. `GET /auth/status` returns `{ role, accountExists, accountId, isOnboarded }`; keep `accountId`.
- Socket events (`presence:snapshot`, `presence:update`, `typing:update`, `conversation:update`) carry the same public ids. Compare them with `accountId` from auth status, or with the agency id when connected with `scope: "agency"`.

## Behavior that changed or is easy to miss

- Missing resources answer 404: `GET /jobs/{jobId}` with `JOB_NOT_FOUND`, `GET /client/profile` and `GET /freelancer/profile` with `PROFILE_NOT_FOUND` (show onboarding, not an error). `GET /agency/mine` is the exception: it answers 200 with `data: null` when the caller has no agency.
- A caller with `scope=agency` and no agency gets 404 `NOT_FOUND` ("No agency workspace was found for this account.") on contract accept, decline, finish and milestone submit; before ADR 0021 some of them answered 403. A missing permission is still 403 `AGENCY_PERMISSION_DENIED`.
- Contract status is `PENDING`, `ACTIVE`, `COMPLETED` or `CANCELLED`. The talent declines with `PATCH /contracts/{contractId}/decline` and the client withdraws with `PATCH /contracts/{contractId}/withdraw`, both only while `PENDING` (otherwise 409 `CONTRACT_NOT_PENDING`). An agency decline needs the `contract.accept` permission. Add the two buttons and a `CANCELLED` badge in the client, freelancer, agency and admin dashboards; none of them shows `CANCELLED` today.
- `PUT /client/profile` takes an optional `country`: ISO 3166-1 alpha-2, uppercase, or `null` to clear. The onboarding and profile forms must send it (the client dashboard has no country field wired). Until a client saves it, their jobs show `clientCountry: null`, so show no location.
- Stripe return URLs carry flags: purchases (job offer checkout, Connects) use `payment=success|cancelled`; milestone funding uses `funding=success|cancelled` on `/contracts?contractId=...`. The `section` values on Stripe return and checkout URLs are `connects`, `withdrawals` and `verifications` (plural) in the freelancer `/settings` and `withdrawals` and `connects` in the agency `/finances`, and `finances` in the client `/settings`.
- Searches (`GET /freelancer/search`, `/agency/search`, `/client/marketplace/search`, `/jobs/public`) take a `query` of at most 100 characters. Every whitespace-separated term (at most 10) must match, in any order, case-insensitively; country names match in English ([ADR 0019](decisions/0019-searchable-text-denormalization.md)).
- Job feeds (`GET /freelancer/jobs`, `GET /agency/jobs`) take `filter=best-match|recent` and return the same item shape; `matchScore` is present only for best-match. Filters: `levels` and `durations` (comma lists), `minBudgetCents`, `maxBudgetCents`, `minProposals`, `maxProposals`, `paymentVerified`. A freelancer with no skills gets an empty best-match feed ([ADR 0022](decisions/0022-job-feeds-evaluated-in-sql.md)).
- Meetings: use the `joinUrl` from `POST /conversations/{conversationId}/meetings` or from `activeMeeting`. It carries a personal `?t=` token: do not share, cache or log it. The URL in the `MEETING_STARTED` message payload has no token and cannot join. When Daily is down, `GET /conversations` and `POST /conversations` still succeed but an `activeMeeting.joinUrl` may be tokenless; retry through the start-meeting call ([ADR 0021](decisions/0021-behavior-changes-agency-scope-daily-webhook-production-keys.md)).
- Agency members: invitation and member-edit requests use `AGENCY_MEMBER` or `BUSINESS_MANAGER`; the display labels ("Agency member", "Business manager") belong to the frontend. `members[].accountId` is the member's public account id and `profileId` the freelancer profile id (nullable). The owner's `members[].role` is a display string ("Founder" plus the title), so use `isOwner`, not `role`, to find the owner. A contract's `counterpartyType` is `CLIENT`, `FREELANCER` or `AGENCY`.
- Attachments are sent inside the JSON body as base64 data URLs (`data:<type>;base64,...`, at most 5 per job); the API uploads them and returns stored references. Do not send a storage URL.

## Code to align before wiring

- Job fields: the API returns camelCase (`expertiseLevel`, `expectedDuration`, `totalBudgetCents`, `publishedAt`, `clientId`, ...). No app uses snake_case job fields today, so new job types should follow the OpenAPI schemas (`JobsPost`, `FreelancerJobFeedItem`).
- [`apps/freelancer-dashboard/app/my-profile/profile-editor.tsx`](../apps/freelancer-dashboard/app/my-profile/profile-editor.tsx) has local snake_case types. `PUT /freelancer/profile` takes `{ freelancerMetadata: { professionalTitle, professionalDescription, hourlyRateCents, weeklyAvailability, availabilityStatus, experienceLevel, country, city, languages, skills }, freelancerPortfolios: [{ title, category, description, liveUrl, coverImage }] }`. So `hourly_rate` (dollars) becomes `hourlyRateCents` (500 to 100000), `client_id` on portfolios is not a field, `live_url` and `cover_image` become `liveUrl` and `coverImage`, `firstName` and `lastName` are not accepted, and `skills` needs 3 to 15 items of at most 20 characters.

## Notifications and reconnects

- `GET /notifications/stream` (server-sent events) has no replay and no `Last-Event-ID`. A push that was missed while disconnected is not resent. Refetch `GET /notifications` on every connect and reconnect of the stream, and on tab focus after a long idle (a few minutes), then merge by `id`.
- The must-not-lose notices are stored in the same database transaction as the change they describe, so a broker outage never loses them; only the live push can be missed, and the refetch recovers it. They are `CONTRACT_OFFER`, `MILESTONE_FUNDED`, `MILESTONE_SUBMITTED`, `MILESTONE_APPROVED`, `MILESTONE_CHANGES_REQUESTED`, `CONTRACT_DECLINED`, `CONTRACT_WITHDRAWN`, `PAYOUT_COMPLETED`, `PROPOSAL_INTERVIEWED` and `AGENCY_INVITATION`.
- The nice-to-have notices still travel through RabbitMQ and can be lost while the broker is down, with no record for the client: `CONTRACT_ACCEPTED`, `MILESTONE_ADDED`, `CONTRACT_COMPLETED`, `REVIEW_RECEIVED`, `PROPOSAL_RECEIVED`, `PROPOSAL_VIEWED`, the answered-invitation notice and `AGENCY_WELCOME_BONUS`. Do not make a screen depend on one of them; read the state from its own endpoint.
- Operators: alert on the log names `queue.publish.skipped` and `queue.publish.failed`; since ADR 0024 they concern only the nice-to-have list.
