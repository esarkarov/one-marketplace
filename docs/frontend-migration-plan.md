# Frontend migration plan

Status: in progress, batch 0 done. The five apps already call the API from the browser with Clerk Bearer tokens and TanStack Query (admin goes through same-origin route handlers). Their data layer still uses the old shapes: bare arrays, snake_case fields and dollars. This plan aligns them with [`api/openapi.json`](api/openapi.json). Per-endpoint pitfalls are in [`frontend-integration-notes.md`](frontend-integration-notes.md).

## Audit findings

- Every API call in the five apps matches an existing operation (path and method). No app calls an endpoint that does not exist.
- The Clerk-based apps (agency, client, freelancer, landing) imported packages that no `package.json` declared, so none could type-check. Batch 0 declares them (see Batch 0 result).
- Landing's origin was missing from the API's allowed origins, so sign-up (Clerk `azp` check) and browser CORS from landing failed. Batch 0 adds `LANDING_PAGE`.
- Three `.env.example` files had the client and freelancer ports swapped. Batch 0 fixes them.
- Docs claimed no app calls the API. Batch 0 corrects them.

### Systematic mismatches

| Area                | Apps today                                                     | API contract                                                                                       |
| ------------------- | -------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| Money               | Dollars (numbers or strings)                                   | Integer cents in `*Cents` fields (ADR 0006); send and read cents, format in the UI                 |
| Pagination envelope | Bare arrays                                                    | Offset lists `data: { results, hasMore }`, cursor lists `data: { results, nextCursor }` (ADR 0012) |
| Conversations       | Old keys for conversations and messages                        | camelCase keys from the OpenAPI schemas; messages use a cursor with default 30, maximum 50         |
| Field case          | snake_case (`expertise_level`, `total_budget`, `published_at`) | lowerCamelCase everywhere, enums UPPER_SNAKE                                                       |
| Ids                 | Clerk ids used as person ids in places                         | Public ids only: `accounts.id`, agency id; `accountId` from `GET /auth/status`                     |
| Errors              | Ad hoc `message` handling                                      | `{ success: false, message, code, requestId, errors? }`; branch on `code`, log `requestId`         |
| Status enums        | Local lowercase or display labels                              | UPPER_SNAKE; contract status includes `CANCELLED`                                                  |
| Notification types  | Old type names                                                 | The kinds in `frontend-integration-notes.md` (must-not-lose list and nice-to-have list)            |

### Request-side differences

The audit found request-side differences on 14 operations (field names, cents, enum values, required `role` or `scope` query parameters). The per-operation list lives in the audit report and is copied into each app's batch when that batch starts; this document does not repeat it so it cannot drift from the OpenAPI document.

## Decisions

- Landing's origin is allowed through `LANDING_PAGE` (same rules as the dashboard origin variables: default `http://localhost:3000` outside production, one of the origin variables required in production, http(s) only). The same list is the Clerk `azp` allowlist.
- The admin cookie stores the API-issued session token and the admin app drops `ADMIN_SESSION_SECRET`. Done in batch 2: the admin app no longer reads the variable. The API still requires `ADMIN_SESSION_SECRET` (it signs and verifies the token).
- Dependency versions are in the pnpm catalog and were approved as installed in batch 0 (newest versions that satisfy the Next 16.4.6 and React 19.3.1 peer ranges and `minimumReleaseAge`).
- `packages/api-client` comes first. `packages/ui` is used only for the brand mark, icons and the notification popover.
- The `proxy.ts` self-fetch of `/api/me` is dropped.
- Decline and withdraw actions and `CANCELLED` badges are in scope (batch 7).

## Security findings to fix

- Landing sends a Clerk JWT in the query string of `GET /api/sign-up`; it must go in a header or a POST body.
- The admin login accepts an open redirect through the `next` parameter; allow same-origin paths only.
- The admin session secret is held by the app; the app should store the API-issued token instead (see decisions).
- The socket keeps a stale token after Clerk rotates it; fetch a fresh token on every connect.
- The notification SSE reader does not retry after a clean end and does not refetch `GET /notifications` on reconnect (the stream has no replay).
- Duplicate notification streams are opened in some apps; keep one per tab.
- The `proxy.ts` self-fetch of `/api/me` adds a round trip and a failure path on every request.

## Batch plan

| Batch | Scope                                                                                                                                              |
| ----- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| 0     | This batch: dependencies, env examples, `LANDING_PAGE`, docs, this plan                                                                            |
| 1     | `packages/api-client` plus formatters (cents, dates), error handling, auth helper (`accountId` from `/auth/status`), notification and socket hooks |
| 2     | admin                                                                                                                                              |
| 3     | client (done, 3a to 3g)                                                                                                                            |
| 4     | freelancer                                                                                                                                         |
| 5     | agency                                                                                                                                             |
| 6     | landing                                                                                                                                            |
| 7     | Decline and withdraw actions and `CANCELLED` badges in all dashboards                                                                              |

Order rationale: admin is the closest match to the contract, so it proves the api-client cheaply. Client is on the revenue critical path (job posting, checkout, funding). Freelancer and agency share code, so agency follows freelancer and reuses it. Landing is last because it only does sign-up and redirects.

Lint override: until an app is migrated, `packages/eslint-config/next.mjs` downgrades five rules to warnings for `agency-dashboard` and `freelancer-dashboard` only (`client-dashboard` left the list in 3g): `@typescript-eslint/no-explicit-any`, `react-hooks/set-state-in-effect`, `react/no-unescaped-entities`, `@typescript-eslint/no-non-null-asserted-optional-chain` and `react-hooks/purity`. An app's entry is removed from that list in the app's last sub-batch, and that batch must leave the app at 0 warnings for these five rules. While migrating, any file a batch rewrites or touches must be cleared of these warnings.

## Status

- 2026-11-20: batch 0 done.
- 2026-11-20: batch 1a done: `packages/api-client` (generated types and operation metadata, typed fetch client with auth, role and scope injection, error envelope handling, money and date formatters). No app uses it yet; the notification and socket hooks, the auth helper and the app wiring remain in batch 1.
- 2026-11-20: batch 2 done (admin): see [Batch 2 result](#batch-2-result). Not yet verified against a running API or a browser.
- 2026-11-20: batch 1b done: `packages/web-core` (`@onemarketplace/web-core`: `ApiProvider` and `queryKeys`, `useAccount`, one shared notification stream per tab with reconnect, backoff and refetch, notifications list and optimistic mutations, one shared messaging socket with a fresh token per handshake, unread counts, sound player). No app uses it yet; the app wiring stays in the app batches.
- 2026-11-20: batch 3a done (client foundations): see [Batch 3a result](#batch-3a-result). Not yet verified against a running API or a browser. The sub-batches are 3b (onboarding, profile, settings), 3c (jobs), 3d (proposals), 3e (contracts and milestones), 3f (messages) and 3g (search and public profiles); `client-dashboard` stays in `unmigratedApps` until 3g.
- 2026-11-21: batch 3b done (client onboarding, profile and settings): see [Batch 3b result](#batch-3b-result). Not yet verified against a running API or a browser.
- 2026-11-21: batch 3c done (client jobs): see [Batch 3c result](#batch-3c-result). Not yet verified against a running API or a browser.
- 2026-11-21: batch 3d done (client proposals): see [Batch 3d result](#batch-3d-result). Not yet verified against a running API or a browser.
- 2026-11-21: batch 3e done (client contracts and milestones): see [Batch 3e result](#batch-3e-result). Not yet verified against a running API, Stripe or a browser; the live check is deferred until the freelancer app can create proposals.
- 2026-11-21: 3e follow-ups done (shared `isHttpsUrl`, redirect before refetch, milestone bounds and rules aligned with the API, contract notice targets): see [3e follow-ups](#3e-follow-ups).
- 2026-11-21: batch 3f done (client messages): see [Batch 3f result](#batch-3f-result). Tier 1 only; not verified against a running API or a browser; the live check is deferred until the freelancer app can start conversations.
- 2026-11-21: batch 3g done (client search, public profiles and dashboard home) and the client app is done: see [Batch 3g result](#batch-3g-result). `client-dashboard` is out of `unmigratedApps`. Tier 2 passed (see the result section). Not verified against a running API or a browser; the full end-to-end order is in [Client dashboard full QA](#client-dashboard-full-qa).
- 2026-11-21: cleanup and extraction after 3g done: see [Cleanup and extraction](#cleanup-and-extraction-after-3g). The app-agnostic client modules now live in `packages/web-core`.
- Next: batch 4 (freelancer app). It also unblocks the live checks that wait for a second actor.

## Batch 0 result

- API: `LANDING_PAGE` added to env parsing, `allowedOrigins` (one list used by CORS and the Clerk `azp` check) and the production origin rule.
- Dependencies: `@clerk/nextjs`, `@clerk/shared`, `@tanstack/react-query`, `socket.io-client`, `timeago.js` and `sonner` are in the catalog and declared where imported. Installed versions are the newest allowed by `minimumReleaseAge` at install time; the lockfile has the exact versions.
- Type errors caused by the missing declarations are gone in agency, client, freelancer and landing. Remaining lint errors (`no-explicit-any`, non-null assertions, React rules) and admin's stale `.next` type errors are left for the app batches.

## Batch 2 result

- Session: `POST /api/session` sends the password to `POST /admin/auth/login` through `@onemarketplace/api-client` and stores the returned token in the `admin_session` cookie (httpOnly, `sameSite=strict`, `secure` in production, `path=/`, `maxAge` computed from `expiresAt` and never longer; a missing, invalid or past `expiresAt` answers 502 and sets no cookie). The token never reaches the browser or the logs. `DELETE /api/session` requires a same-origin request (`Sec-Fetch-Site`, else `Origin` against `Host`) and answers 403 otherwise.
- The admin app no longer holds `ADMIN_SESSION_SECRET` (removed from the code and the admin `.env.example`). The API still requires it.
- `proxy.ts` only checks that the cookie exists (`lib/access.ts`, `decideAccess`). Pages redirect to `/login?next=<safe path>`; `/api/*` answers 401 JSON with code `UNAUTHENTICATED`. The API is the authority: a 401 from it sends server components to `/login?expired=1&next=<path>` and browser calls to the same place.
- `next` is validated by `safeNextPath` everywhere it is read or written.
- Route handlers under `app/api/system/*` and `app/api/logs/stream` forward `request.signal` upstream. Upstream 401 is returned as 401, every other upstream failure as 502 with the API error code (so a 400 or 403 from the API reaches the browser as 502 with the API message). Touch-up after batch 2: the two Redis routes (`/api/system/redis/keys` and `/keys/[key]`) now pass an upstream 4xx through with its status and error envelope (including `errors[]`); 5xx and network failures stay 502, and the health and log stream routes are unchanged. A login answered with 503 `SERVICE_UNAVAILABLE` returns 502 with code `ADMIN_AUTH_NOT_CONFIGURED` and the form shows "Admin sign-in is not configured on the server."; 401 still shows "Incorrect password.".
- Money comes from `*Cents` fields formatted with `formatCents`; contract status includes `CANCELLED` (red, "Cancelled"); contracts, proposals and accounts show `AGENCY`/`FREELANCER`/`CLIENT` labels.
- `apps/admin-dashboard/tsconfig.json` sets `target` to `ES2020` because the api-client source uses BigInt literals.
- Known limitation: the API limits failed admin logins to 20 per 15 minutes per IP, and every admin reaches it through the Next server's IP, so failed attempts by one admin count against all of them. The API was not changed.
- Known limitation: the log stream is an `EventSource`; a 401 closes it for good, so the page shows "Log stream closed" and needs a reload.
- A stale `apps/admin-dashboard/.next` (from an old `next dev`) makes `tsc` and `next build` fail on `.next/dev/types`; delete that folder locally.

### Manual QA checklist (owner)

1. Start Postgres, Redis and the API (`ADMIN_DASHBOARD_PASSWORD` and `ADMIN_SESSION_SECRET` set), then `pnpm --filter @onemarketplace/admin-dashboard dev` with `NEXT_PUBLIC_SERVER_URI=http://localhost:4000/api/v1`.
2. Open `/accounts` signed out: redirected to `/login?next=%2Faccounts`. Open `/login?next=//evil.example` and sign in: lands on `/`.
3. Wrong password shows "Incorrect password."; the right one lands on the requested page. In devtools the `admin_session` cookie is HttpOnly, SameSite=Strict, and its expiry is about 2 hours out.
4. Visit Overview, Accounts, Job posts, Proposals, Contracts, Transactions, Systems and Logs. Amounts show dollars and cents (a 1999 cents value shows `$19.99`); Systems shows Redis, Postgres and RabbitMQ.
5. Check a cancelled contract: red "Cancelled" badge in the table and the detail view. Talent kind shows as Agency or Freelancer.
6. Expire the session (delete the cookie while on the page, or wait 2 hours): the next page load or Systems refresh goes to `/login?expired=1&next=...` with the notice.
7. `curl -i http://localhost:3004/api/system/health` without a cookie answers 401 JSON, not a redirect. `curl -i -X DELETE http://localhost:3004/api/session -H "Origin: https://evil.example"` answers 403.
8. Open Logs, then close the tab: the API connection count drops (no leaked upstream stream).
9. Log out: cookie cleared, back on `/login`.

## Batch 3a result

- Wiring: `apps/client-dashboard` depends on `@onemarketplace/api-client` and `@onemarketplace/web-core` (`workspace:*`, both in `transpilePackages`), has vitest and `target` ES2020. `app/provider.tsx` mounts web-core's `ApiProvider` (`baseUrl` from `NEXT_PUBLIC_SERVER_URI`, role `client`, `getToken` from Clerk `useAuth`) inside `ClerkProvider`; its own `QueryClient` replaces the app's.
- Session: `app/session-boundary.tsx` mounts the notification stream, the messaging socket and the message sound only while Clerk reports a signed-in user, and calls `resetWebCore` when it reports none. Notification and conversation queries in the header are `enabled` only when signed in.
- Account: the Clerk `userId` is no longer used as a public id in the header hooks (`use-unread-messages.ts`); incoming-message sound uses `useAccount().isMine(senderId)`. `messages-dashboard.tsx` still compares Clerk ids and is left for the messages sub-batch.
- `proxy.ts` keeps Clerk authentication and the signed-out redirect to the landing page and makes no network call. The `/api/me` self-fetch is gone; its decision now lives in `AccountGate` (`app/session-boundary.tsx`) over `GET /auth/status` (same query key as `useAccount`, one request): failed check, no account or a role other than `client` go to the landing page; a client that is not onboarded goes to `/profile/edit` (allowed there); otherwise the page renders. The decision is the pure function `decideAccountGate` in `lib/account-gate.ts`. `app/api/me/route.ts` was removed (the `/api/me` bypass left in `proxy.ts` matches no route).
- Notifications: the data layer is web-core's `useNotifications`, `useUnreadNotificationCount`, the optimistic read mutations and the shared stream (one per tab, refetch on reconnect); the sound is `createSoundPlayer`. Click targets come from `lib/notification-routes.ts`: all contract and milestone types go to `/contracts`, `PROPOSAL_RECEIVED` and `PROPOSAL_VIEWED` to `/proposals`, `PROPOSAL_INTERVIEWED` to `/messages`; the notice's own `link` is used only when it stays inside that route (keeps `?contractId=` and `?conversationId=`). `PAYOUT_COMPLETED`, `AGENCY_INVITATION`, `AGENCY_WELCOME_BONUS`, `REVIEW_RECEIVED` and unknown types have no client route: the row marks as read and does not navigate.
- Origin: the API allows the client dashboard through `CLIENT_DASHBOARD`; outside production `http://localhost:3001` is the default when it is unset.
- Pages for later sub-batches still call the API with the old shapes and may fail at runtime until their own sub-batch.

### Manual QA checklist (owner) for 3a

1. Start the API and `pnpm --filter @onemarketplace/client-dashboard dev` with Clerk dev keys and `NEXT_PUBLIC_SERVER_URI=http://localhost:4000/api/v1`.
2. Signed out, open `http://localhost:3001/`: redirected to the landing page, and the network tab shows no request to the API.
3. Sign in as a client: a short "Loading your account…" then the dashboard; one `GET /auth/status?role=client` is sent. A freelancer account or an account without a profile ends on the landing page.
4. A client that is not onboarded is sent to `/profile/edit` from any page and can stay there.
5. The header and the notification bell load without console errors; the bell badge shows the unread count and the popover lists the latest three.
6. The stream connects (`GET /notifications/stream` stays open in the network tab) and there is exactly one per tab; reload and it reconnects, and the list is refetched on connect.
7. Create a notification for the client (for example a milestone submitted by a freelancer): it appears without reload and the badge goes up. Mark one read and mark all read: the badge drops at once and stays after reload.
8. Click a milestone, contract or proposal notification: you land on `/contracts`, `/proposals` or `/messages` as in the table above. A notice with no client route only marks as read.
9. Sign out: the stream closes and no API calls follow.

## Batch 3b result

- Onboarding path: `GET /auth/status` reports `isOnboarded=true` for a client once `PUT /client/profile` has run (`markClientOnboardingComplete` in the same transaction as the profile upsert, auth cache invalidated). No new endpoint or field was needed. The profile `country` is optional in the API but the form now requires it and sends an ISO 3166-1 alpha-2 code.
- Operations used: `client_get_profile`, `client_put_profile`, `client_get_hiring_overview`, `client_get_completed_contracts` (`limit=50`), `client_get_finances_manage_link`, `identity_post_session`. Hooks are in `app/hooks/use-client-profile.ts`; pure mapping, validation and money helpers are in `lib/client-profile.ts` (tests: `lib/client-profile.test.ts`).
- `GET /client/profile` answering 404 `PROFILE_NOT_FOUND` is a new account, not an error: the hook returns `null` and the form shows defaults. After a save the hook updates the profile cache (same `profile-metadata` key the header and sidebar still read) and invalidates the web-core auth status query, so `AccountGate` passes; the page then goes to `/profile` with the router (no full reload).
- Errors: `ApiError` with `errorMessage`, `requestId` shown as a reference, `errors[]` mapped to form fields (`professionalRole` to Role, `country` to Location, `industry` to Custom industry). Local validation mirrors the API limits and runs before the request.
- Money: the profile preview now reads `totalSpentCents` and `budgetCents` and formats them with `formatCents` (compact form for the total).
- Settings: company form hydrates from the loaded profile without an effect and sends the full body (including the saved role and country, so a company edit never clears them). Finances (Stripe link) and identity verification use the typed client.
- Left for later: `client-header.tsx` and `client-sidebar.tsx` still fetch `/client/profile` by hand under the same query key, and `app/api/me/route.ts` was removed (the `/api/me` bypass left in `proxy.ts` matches no route). The completed-contracts list shows the first 50 only (`hasMore` is ignored). The Notifications settings toggles are local only (no API). Public profiles stay in 3g.
- Not yet verified against a running API or a browser. Five-rule warnings in the client app: 13 before, 11 after (the two `set-state-in-effect` in `settings-client.tsx` are gone).

### Manual QA checklist (owner) for 3b

1. Start the API and the client app with Clerk dev keys and `NEXT_PUBLIC_SERVER_URI=http://localhost:4000/api/v1`. Sign up a new client account: you land on `/profile/edit`, and every other URL sends you back there.
2. Submit the form empty: each required field shows its message and nothing is sent. Enter a website without `https://`: the URL message shows on the field.
3. Force an API validation error (for example a 6000-character description or a 101-character role): the message appears on that field and a reference id shows under the form; the data in the form is kept.
4. Fill everything (photo, name, role, country, company data) and save: `PUT /client/profile` answers 200, you land on `/profile` and the dashboard opens without a redirect. `GET /auth/status` now reports `isOnboarded: true`.
5. Open `/settings?section=company`: the saved values are shown. Change one field and save: the button enables only when something changed, the notice shows, and a reload keeps the change. Role and country (see `/profile/edit`) are unchanged.
6. Open `/profile`: role, company, industry and the join year show; hiring stats and completed contracts show amounts like `$1,999.00` (not raw cents).
7. Settings, Finances: "Manage finances" opens Stripe. Verification: "Verify with Stripe" opens Stripe Identity; `/settings?section=verifications&active=true` opens the modal once and Cancel closes it for good.
8. Sign out and sign in again: you go straight to the dashboard, with no pass through `/profile/edit`. With the API stopped, the profile and settings pages show an error message instead of a blank page.

## Batch 3c result

- Operations used: `jobs_get` (`limit` 10, `offset`), `jobs_post`, `jobs_get_by_job_id`, `jobs_put_by_job_id`, `jobs_delete_by_job_id`. Hooks and query keys (`["client-jobs", ...]`) are in `app/hooks/use-jobs.ts`; pure mapping, validation, money, status and error helpers are in `lib/jobs.ts` (tests: `lib/jobs.test.ts`). Create, edit and delete invalidate the jobs queries and the proposals page's job query.
- Shapes: camelCase bodies (`expertiseLevel`, `expectedDuration`, `screeningQuestions`, `milestones[].budgetCents`, `dueDate`); responses use `totalBudgetCents`, `milestones[].budgetCents`, `proposalCount`, `shortlistCount`, `hireCount`, `createdAt`. Input dollars become cents with `dollarsToCents` (a number such as 0.1 + 0.2 or more than 2 decimals is rejected, no float math); display uses `formatCents`. The spec has no `minBudgetCents` or `maxBudgetCents` on these operations.
- List: `{ results, hasMore }` with Previous and Next buttons (page size 10, offset = page x 10, `keepPreviousData`, buttons disabled while fetching and at the ends). An empty later page (for example after deleting the last job on it) shows "No more job posts." with Previous.
- Status: every value of the spec enum has an explicit label (`DRAFT` Draft, `PUBLISHED` Open, `HIRED` Hired); an unknown value is shown as received, never as "Closed". Edit is hidden for jobs with hires and locked for `HIRED` jobs; 409 `JOB_LOCKED` shows the API message.
- Errors: `ApiError` with `errorMessage`; `errors[]` paths map onto form fields (`expertiseLevel` to Expertise level, `expectedDuration` to Duration, `milestones.N.budgetCents` to that milestone's budget, `milestones.N.dueDate`, `screeningQuestions.N`, `skills`, `attachments`); a banner under the top of the form shows the message and `(reference <requestId>)`. Delete errors show inside the confirm dialog. 404 `JOB_NOT_FOUND` on the edit page shows "Job post not found."; other load errors show the message with the reference.
- Validation: milestone budget is at least $10 and at most $1,000,000 (the API accepts more than 500 cents and up to 100,000,000 cents per milestone; the form keeps its $10 floor); the budget input now takes cents (`step="0.01"`).
- Due dates: the hardcoded year 2026 parsing is gone. The API stores `dueDate` as text; ISO dates (what the form sends) and ISO timestamps are used as they are, text with a year ("Dec 5, 2027") is parsed, and text without a year ("Dec 5") becomes empty so the owner picks the date again instead of getting a wrong year.
- Fixed on the way: "Save draft" never ran because `handleSubmit(...)` was not invoked; new attachments are sent without a `fileId` (was `""`).
- Header and sidebar: all three hand-written `/client/profile` fetches now use `useClientProfile` (one shared query, one request). `identityVerified === false` still gates the `/contracts/client` fetch and the warning banner; a profile of `null` (404 `PROFILE_NOT_FOUND`) means no company name and no banner.
- Proposals exception: `proposals-dashboard.tsx` only had its `GET /jobs` call moved to the typed client (`limit` 100, first page only, mapped from `results`); the rest of the file, its 5 `any` and 1 `set-state-in-effect` warnings are left for 3d. `ClientJob.id` is typed `number` in `client-data.ts` but the API id is a uuid string (the file already compares with `String(item.id)`); two casts bridge it until 3d. The dollar `budget` and milestone `amount` there are derived from cents for display only.
- Known limitations: the spec has no close or cancel operation for a job, so none was added (a published job can only be edited or deleted; a hired job is locked). The proposals page sees at most the first 100 jobs. Not verified against a running API or a browser. Five-rule warnings in the client app: 11 before, 9 after (header and sidebar no longer have any; `proposals-dashboard.tsx` keeps 6).

### Manual QA checklist (owner) for 3c

1. Start the API and the client app (Clerk dev keys, `NEXT_PUBLIC_SERVER_URI=http://localhost:4000/api/v1`). Open `/jobs` with no jobs: "You have not posted any jobs yet."
2. Create: `/jobs/new`, fill the form with two milestones (for example $19.99 and $10). The total shows `$29.99`. Publish: `POST /jobs` carries `budgetCents` 1999 and 1000, you land on `/jobs`, and the card shows `Open` and `$29.99`.
3. Save draft on a new job: the request is sent with `status: "DRAFT"` and the card shows `Draft`.
4. Edit: open Edit on a job, change the title and a budget, save. `PUT /jobs/{id}` is sent, the list and the edit form show the new values after reload, and the budget round trips with cents (19.99 stays 19.99).
5. List with pagination: with more than 10 jobs, Next shows the second page and Previous returns; both are disabled at the ends and while loading.
6. Delete: Edit, Delete job post, confirm. The job disappears from the list. Repeat on a deleted job's edit URL: "Job post not found.".
7. Validation: a milestone under $10 shows "Budget must be at least $10.00."; more than 2 decimals is refused. Force an API error (a 101-character title through devtools, or a 5001-character description): the message lands on that field, the banner shows the reference id, and the form keeps its data.
8. A hired job: Edit is hidden in the list and `/jobs/{id}/edit` shows "This job post is locked".
9. Header and sidebar: after loading any page there is one `GET /client/profile` request; the company name shows in the sidebar and the account menu; saving the profile updates both without reload. A new account without a profile (404 `PROFILE_NOT_FOUND`) shows no company name and no verification banner.
10. `/proposals` still lists the jobs as cards (`Open` for published, budgets in dollars) and `/proposals?job=<id>` opens the selected job.

## Batch 3d result

- Operations used: `jobs_get` (job picker, `limit` 10 and `offset`, through `useJobs`), `jobs_get_by_job_id` (the selected job, through `useJob`, so a job on any page opens), `proposals_get` (`jobId`, `limit` 10, `offset`), `proposals_patch_by_proposal_id_status` (mark viewed with no body, shortlist with `{ isShortlisted: true }`), `proposals_post_by_proposal_id_interview`, `contracts_post_checkout`. Hooks and query keys (`["client-proposals", ...]`) are in `app/hooks/use-proposals.ts`; pure mapping, status, filter, money and error helpers are in `lib/proposals.ts` (tests: `lib/proposals.test.ts`). `client-data.ts` is untouched: `ClientJob` and `ClientProposal` stay for the talent profile and the other sub-batches, and `proposals-dashboard.tsx` no longer imports them.
- Pagination: both lists are `{ results, hasMore }` with limit and offset (the spec has no cursor for proposals) and Previous and Next buttons. The "first 100 jobs" workaround is gone: the job picker pages through `GET /jobs` like `/jobs` does. The proposals list pages on the server (10 per page); the status tabs and their counts filter the loaded page only, and the text says so.
- Money: `bidAmountCents` and the job and milestone `*Cents` fields are shown with `formatCents`; no dollar number is derived anywhere in this scope. The contract offer modal shows the first job milestone as `formatCents(budgetCents)`. There is no money input on these screens, so `dollarsToCents` is not needed.
- Ids: all ids are strings (uuid). Both `as unknown as` casts and all `any` in the file are gone; the list items are narrowed from the `ProposalsClientItem | ProposalsFreelancerItem` union with `isClientProposalItem`.
- Status: every value of the spec enum has an explicit label (`SUBMITTED` New, `VIEWED` Viewed, `INTERVIEWED` Interview, `HIRED` Hired); an unknown value is shown as received. `HIRED` used to be shown as "New". The shortlist flag is a separate badge and a separate tab (`Shortlisted`), no longer a replacement of the status. The old tabs "Offer sent" and "Rejected" are removed: the spec has no status or action behind them (there is no reject operation).
- Actions: View proposal marks it viewed only while it is `SUBMITTED`; Shortlist shows "Shortlisting..." and then refreshes the list and the job counts (no optimistic update, no un-shortlist operation exists); Start interview posts the message, then goes to `/messages?conversationId=...`; "Go to interview" appears when the proposal is `INTERVIEWED` or `HIRED` and has a conversation; `HIRED` without a conversation hides the interview button; "See contract" shows when `contractId` is set; "Send contract offer" is hidden for `HIRED` proposals.
- Contract offer: kept. It is one operation on the proposal (`contracts_post_checkout` with `{ proposalId }`, answers a Stripe checkout `url`), so it is migrated here. The redirect only happens for an `https:` url; anything else shows "Checkout returned an invalid address.". The contract itself (offer, accept, funding) is shown in `/contracts` and stays for 3e.
- Errors: `ApiError` with `errorMessage` and the `requestId` as "(reference ...)" (`proposalErrorMessage`). A list failure, a failed shortlist (notice), a failed interview and a failed checkout (inside their modals) show the API message. A job that is not found shows "Job post not found.".
- Fixed on the way: the "View profile" link for a freelancer used `freelancerId`, a field the API does not send (it linked to `/talent/undefined`); it now uses `profileId` (the id `GET /freelancer/profile/{id}` takes) and is hidden when it is null. `/proposals?job=<id>` (the link on the jobs list) was ignored by the page; it now redirects to `/proposals/<id>` for a uuid.
- Notification click targets: `PROPOSAL_RECEIVED` carries the link `/proposals/<jobId>` and `PROPOSAL_VIEWED` carries `/my-proposals`; `notificationHref` keeps a link only inside the type's base, so received lands on `/proposals/<jobId>` (works) and viewed falls back to `/proposals` (works; viewed is a freelancer notice, the client does not receive it). `PROPOSAL_INTERVIEWED` goes to `/messages` or `/messages?conversationId=<id>` (works; the messages screen itself is 3f).
- Missing in the spec, not invented: a single-proposal read (the drawer uses the list row), a reject or decline action for the client, an un-shortlist action, a per-status filter or counts for the client list.
- Known limitations: not verified against a running API or a browser. The drawer's milestone list is the job's milestones (the proposal has no milestone plan). Five-rule warnings in the client app: 9 before, 3 after (all in `contracts-dashboard.tsx`: two `set-state-in-effect`, one `no-unescaped-entities`; `proposals-dashboard.tsx` had 6 and now has 0).

### Test data for 3d (only existing API operations)

A proposal needs a published job by a client, and a freelancer who is a different account, is onboarded (that creates the 60 Connects; a proposal costs 6) and answers every screening question. The freelancer app is not migrated, so create the freelancer side with the Swagger UI (`pnpm infra:up`, then `http://localhost:8081`, server `http://localhost:4000/api/v1`; the API must be running). Each step below was checked against the API code; none was run.

1. Client: sign in to the client app (`http://localhost:3001`) and publish a job on `/jobs/new` (note its screening questions, if any, and the job id in the `/jobs/<id>/edit` URL).
2. Freelancer account: in a second browser profile or a private window, sign up a second Clerk user as a freelancer on the landing page, or use an existing freelancer. In that window, on a page of an allowed local origin (`http://localhost:3000` to `3004`; `allowedOrigins` in `services/api/src/config/cors.ts`), run `await window.Clerk.session.getToken()` in the console and copy the token. Tokens are short lived; fetch a new one when a call answers 401.
3. In Swagger UI choose Authorize and paste the token (bearer). Every call below needs `role=freelancer` in the query (the API reads the role from the query or the body; a missing role answers 400).
4. `POST /auth/sign-up` with `{ "role": "freelancer" }` creates the account row if the landing page did not (`accountExists` in the answer). `GET /auth/status?role=freelancer` shows `isOnboarded`.
5. Onboard: `PUT /freelancer/profile?role=freelancer` with `freelancerMetadata` (`professionalTitle`, `professionalDescription`, `hourlyRateCents` 500 to 100000, `country` such as `US`, `city`, `availabilityStatus`, `weeklyAvailability`, `experienceLevel`, `skills` 3 to 15 of at most 20 characters, `languages` 1 to 5 each with `language` and `proficiency`) and `freelancerPortfolios` with one item (`title`, `category`, `description`, `liveUrl` or null, `coverImage: { "url": "data:image/png;base64,..." }`, any small image data URL). The controller answers 400 for any missing piece. The cover image goes to ImageKit, so the API needs `IMAGEKIT_PRIVATE_KEY` (otherwise 503 "Portfolio image uploads are not configured."). The first save grants the 60 Connects (`addConnects`, only while `isOnboarded` was false).
6. Submit: `POST /proposals?role=freelancer` with `{ "jobId": "<job id>", "coverLetter": "<80 to 10000 characters>", "bidAmountCents": 150000, "duration": "2 weeks", "screeningAnswers": ["...", ...] }`. `screeningAnswers` needs exactly one non-empty answer per screening question (omit it for a job without questions). Errors: 404 job not found (the job must be `PUBLISHED`), 403 for a job of the same account, 400 "Not enough Connects." (not onboarded), 409 already submitted (one proposal per job and freelancer). The client gets a `PROPOSAL_RECEIVED` notice with the link `/proposals/<jobId>`.
7. An agency proposal (`POST /agency/proposals?role=freelancer`, same body, needs an agency workspace with the `proposal.send` permission) is not covered here.
8. The interview and "See contract" states come from the client UI (QA steps 7 and 9). `HIRED` needs the whole contract flow (Stripe checkout and webhook, freelancer acceptance) which belongs to 3e; this batch only checks its label if you have such a row.

### Manual QA checklist (owner) for 3d

1. Prepare as above. With no proposals, `/proposals` lists your jobs: `Open` for published ones, budgets like `$1,500.00`, counts of proposals, shortlisted and hires; "View proposals" is disabled for a job with none. With more than 10 jobs Next and Previous page through them; with none, "You have not posted any jobs yet.".
2. `/jobs` "Review proposals" opens `/proposals/<id>` (through `/proposals?job=<id>`). `/proposals/<unknown uuid>` shows "Job post not found."; `/proposals/not-a-uuid` shows the API validation message.
3. `/proposals/<jobId>` shows the job title, budget with cents, counts, skills and the proposal card: a bid such as `$1,500.00`, the freelancer name, title, location, rating, Success percent, "Submitted ... ago" and the status `New`.
4. "View proposal": the drawer opens at once; one `PATCH /proposals/<id>/status?role=client` is sent and the badge becomes `Viewed` after the refetch. Open it again: no second PATCH. The drawer shows the cover letter, the job milestones with amounts and the screening answers.
5. Shortlist: the notice "Proposal shortlisted." shows, the card gets a `Shortlisted` badge next to its status, the Shortlisted tab count and the job's Shortlisted metric go up and the button disappears. Reload: it stays.
6. Tabs New, Viewed, Shortlisted, Interview and Hired filter the loaded page and show their counts; there are no Offer sent or Rejected tabs. With more than 10 proposals Next and Previous page through them.
7. Start interview (drawer): an empty or whitespace message cannot be sent; sending lands on `/messages?conversationId=<id>`; the proposal then shows `Interview` and the drawer says "Go to interview". Starting it a second time from another tab (409 "Interview has already been started.") shows the message and the reference in the modal. The freelancer gets the 6 Connects back.
8. "Send contract offer": the modal shows the first milestone and its amount; Pay Now redirects to Stripe checkout (needs Stripe test keys). An API failure shows its message in the modal and Pay Now works again.
9. A proposal with a contract shows "See contract" instead of the offer button and links to `/contracts?contractId=<id>`. A `HIRED` proposal shows `Hired`, not `New`.
10. Notifications: a `PROPOSAL_RECEIVED` notice (step 6 of the test data) opens `/proposals/<jobId>`; a `PROPOSAL_INTERVIEWED` notice (the freelancer's, visible only if you sign in as that user) goes to `/messages`.
11. "View profile" opens `/talent/<profileId>` for a freelancer and `/agency/<agencyId>` for an agency; a freelancer without a profile id shows no link. With the API stopped, the lists show an error message instead of a blank page.

## Batch 3e result

- Operations used: `contracts_get_client` (`limit` 20, `offset`), `contracts_post_by_contract_id_milestones_by_milestone_id_checkout` (fund), `contracts_patch_by_contract_id_milestones_by_milestone_id_review` (`APPROVE`, `REQUEST_CHANGES` with feedback), `contracts_post_by_contract_id_milestones` (add milestone), `contracts_post_by_contract_id_finish` (finish and review), `contracts_patch_by_contract_id_withdraw`. Hooks and the `["client-contracts"]` query key are in `app/hooks/use-contracts.ts`; pure mapping, status, money, validation and error helpers are in `lib/contracts.ts` (tests: `lib/contracts.test.ts`). The key prefix is unchanged, so the messages screen's own invalidation keeps working.
- Shared hook: `useContracts(page, { enabled })` is used by the contracts screen and by the header (verification banner, first page only, enabled only while `identityVerified === false`). The hand-written `/contracts/client` fetch is gone.
- Shapes: the list is `{ results, hasMore }` (it used to be treated as an array and would throw); `totalAmountCents` and `amountCents` replace the dollar fields; ids are uuid strings; the add-milestone body is `{ title, amountCents, dueDate }` (the old body sent dollars as `amount` and the API rejects it). `ClientContract` is removed from `client-data.ts` (nothing else used it).
- Money: every amount is shown with `formatCents`; the add-milestone input goes through `validateMilestoneAmount` and `dollarsToCents` (at most 2 decimals, no float math; the bounds were corrected in the 3e follow-ups). Totals and progress are integer cent sums; cancelled contracts are left out of the summary cards.
- Status: contract `PENDING` Awaiting approval, `ACTIVE` Active, `COMPLETED` Completed, `CANCELLED` Cancelled (red); unknown values are shown as received. Milestone status has no "submitted" value in the spec: a milestone is Submitted when `status` is `ACTIVE` and `paymentRequestedAt` is set (this is what the review operation checks), In progress when `ACTIVE` without it, Upcoming when `PENDING`, Paid when `COMPLETED`. The old UI never produced Submitted, so Approve and Request changes were unreachable, and `CANCELLED` showed as Completed with a "Give review" button.
- Approve and Request changes were local state only (no API call). They now call the review operation, wait for the answer, show the API error with its reference, and refetch. The submission message and delivery link of the freelancer are shown (the link is clickable only when it is `https:`).
- Money actions: the control is disabled while the request is pending and a ref lock rejects a second click in the same tick (`useLockedMutation`); the modals cannot be closed while a request runs. The spec has no idempotency key on any contract operation (no header and no body field), so none is sent; the guard above and the API's own state guards (409 `MILESTONE_NOT_SUBMITTABLE`, `CONTRACT_NOT_PENDING`, `MILESTONE_ADD_NOT_ALLOWED`) are the protection. Fund follows the Stripe `url` only when it is `https:` (otherwise "Checkout returned an invalid address."), keeps the button disabled after success until the page leaves, and starts the redirect before the refetch (see 3e follow-ups). Errors show `message` and `(reference <requestId>)`.
- Withdraw offer: new button on a `PENDING` contract (card and drawer) with a confirmation dialog. It calls `PATCH /contracts/{id}/withdraw` (client only): the contract becomes `CANCELLED` (`CONTRACT_WITHDRAWN` goes to the freelancer, none if the owner is an agency), the job goes back to `PUBLISHED` and the first payment is refunded after the transaction; repeating the call repairs a failed refund. Decline: the spec offers it only to the talent (`PATCH /contracts/{id}/decline`, `requireFreelancer`); the client receives `CONTRACT_DECLINED` and sees the contract as Cancelled. No client decline was added.
- Notification click targets: unchanged (`lib/notification-routes.ts` was not edited). `CONTRACT_DECLINED`, `CONTRACT_COMPLETED`, `MILESTONE_ADDED` and `MILESTONE_FUNDED` carry `/contracts?contractId=<id>` and open that contract. `CONTRACT_OFFER`, `CONTRACT_ACCEPTED`, `CONTRACT_WITHDRAWN`, `MILESTONE_SUBMITTED`, `MILESTONE_APPROVED` and `MILESTONE_CHANGES_REQUESTED` carry `/messages?conversationId=<id>`, which is outside `/contracts`, so they land on `/contracts` without a `contractId` (same as before this batch). The notice metadata has `contractId`; the 3e follow-ups use it for these types.
- Missing in the spec, not invented: a single-contract read (the drawer uses the list row, so `?contractId=` opens only when the contract is on the loaded page; otherwise a hint tells you to page), a client decline, an idempotency key, any client payout operation.
- Known limitations: page size 20 with Previous and Next; the summary cards and the header banner cover the loaded page only. The messages screen still has its own review call (moved in 3f). Not verified against a running API, Stripe or a browser. Five-rule warnings in the client app: 3 before, 0 after (`contracts-dashboard.tsx` had two `set-state-in-effect` and one `no-unescaped-entities`). `client-dashboard` stays in `unmigratedApps` until the last sub-batch (3g) and the owner's approval.

### Stripe test mode for 3e (live check deferred)

DEFERRED: the live check cannot run until the freelancer app can create proposals, because a contract needs a proposal, a checkout and a freelancer acceptance. Until then only the unit tests and a code read cover this batch. When it is possible:

1. Use Stripe test keys in the API environment (`STRIPE_SECRET_KEY` as `sk_test_...`) and start the API. The webhook route is `POST /api/v1/contracts/webhook` (raw body, signature header `stripe-signature`, verified with `STRIPE_WEBHOOK_SECRET`). It handles `checkout.session.completed` and `checkout.session.async_payment_succeeded`: contract creation for the offer checkout and milestone funding for the milestone checkout.
2. Forward events with the Stripe CLI (installed and logged in to the same test account): `stripe listen --events checkout.session.completed,checkout.session.async_payment_succeeded --forward-to localhost:4000/api/v1/contracts/webhook`. It prints a signing secret (`whsec_...`); put it in the API's `STRIPE_WEBHOOK_SECRET` and restart the API. Connects and identity use their own secrets and routes.
3. Pay with the test card `4242 4242 4242 4242`, any future expiry, any CVC and any postal code. `4000 0000 0000 9995` pays with a declined card and is useful for the failed path.

### Manual QA checklist (owner) for 3e

Prepare as in "Test data for 3d" and the Stripe steps above. DEFERRED until the freelancer app can create proposals.

1. `/contracts` with none: "No contracts yet." With the API stopped an error message shows instead of a blank page.
2. Offer: on `/proposals/<jobId>` Send contract offer, Pay Now with the test card. After the webhook the contract shows `Awaiting approval` with the total as `$1,500.00`-style text (no raw cents). Pay Now cannot be double-submitted.
3. Withdraw: on the pending contract click Withdraw offer, confirm. The button shows "Withdrawing…" and cannot be clicked twice; the card becomes `Cancelled` (red) with no review button, the job is `Open` again and the Stripe payment is refunded. Withdrawing again from another tab shows the API message with a reference. The freelancer receives `CONTRACT_WITHDRAWN`.
4. After the freelancer accepts, the contract is `Active`. Open View contract: the URL becomes `/contracts?contractId=<id>` and the drawer opens; reload keeps it. A contract on a later page shows the hint to use Next.
5. Fund: on an Upcoming milestone whose predecessors are Paid, Activate milestone, add requirements, Fund & activate. One `POST .../checkout` is sent, the button stays disabled, and you land on Stripe (https only). Pay with `4242 4242 4242 4242`; the webhook runs and the milestone becomes In progress after returning. Cancel at Stripe: it stays Upcoming. An API error shows in the modal with a reference.
6. Submit the milestone as the freelancer (Swagger `PATCH .../submit`). It shows `Submitted` with the submission message and link, and Request changes and Approve & release appear.
7. Request changes: fewer than 10 characters is refused locally; a valid message sends `REQUEST_CHANGES`, the milestone returns to In progress, the freelancer is notified. Approve: confirm, one `PATCH .../review` with `APPROVE`, the milestone is Paid, Paid and progress update, and the amount equals the milestone amount.
8. Add milestone when every milestone is Paid: $9.99, 3 decimals and a past date are refused; $20.00 sends `amountCents: 2000` and the new milestone is Upcoming. Finish contract needs a rating and at least 10 characters; the contract becomes Completed and "Give review" disappears.
9. Header: with an unverified identity and an Active contract the red banner shows, from the same query (one `GET /contracts/client` per page load).
10. Notifications: `CONTRACT_DECLINED` (freelancer declines a pending offer) opens `/contracts?contractId=<id>` with the contract Cancelled; `MILESTONE_FUNDED` opens the contract; `MILESTONE_SUBMITTED` opens `/contracts` (no id, see limitations).
11. A checkout response whose `url` is not https must show "Checkout returned an invalid address." and not navigate (covered by unit tests; hard to force live).

## 3e follow-ups

- `isHttpsUrl` (`lib/url.ts`, tests in `lib/url.test.ts`) replaces the misleading `isCheckoutUrl` of `lib/proposals.ts`. It accepts only `https:` urls without a username or password and is used by the contract checkout redirect, the proposal checkout redirect, the freelancer delivery link, the meeting join url and attachment links.
- Fund milestone: the redirect to the Stripe url starts first, then the contracts query is refetched without awaiting it. The button stays disabled through `isSuccess`.
- Checked read-only against the API code. Mismatches found and fixed (constants and rules now match, with tests):
  - Job milestone budget: the API (`jobs.schema.ts`) accepts `budgetCents` from 501 to 100,000,000; the client minimum was 1,000. Now `JOB_MILESTONE_MIN_CENTS` 501 and `JOB_MILESTONE_MAX_CENTS` 100,000,000 in `lib/jobs.ts` (the form message reads "at least $5.01").
  - Add milestone amount: the API (`contracts.schema.ts`) accepts 1,000 cents up to `MAX_MONEY_CENTS` (`Number.MAX_SAFE_INTEGER`); the client capped it at $1,000,000. Now `ADD_MILESTONE_MIN_CENTS` and `ADD_MILESTONE_MAX_CENTS` in `lib/contracts.ts`; the hint reads "At least $10.00". The title bounds (3 to 120) already matched.
  - `canFinishContract` and `canAddMilestone`: the API (`contracts.milestones.service.ts`, `contracts.lifecycle.service.ts`) allows both while the contract is `ACTIVE` and no milestone is incomplete (`MILESTONE_ADD_NOT_ALLOWED` and `CONTRACT_HAS_INCOMPLETE_MILESTONES` otherwise); a contract with no milestones passes. The client also required at least one milestone; that extra condition is removed. Reviewing a `COMPLETED` contract is a separate rule (`canGiveReview`) and is unchanged.
- Notification targets: for `CONTRACT_OFFER`, `CONTRACT_ACCEPTED`, `CONTRACT_WITHDRAWN`, `MILESTONE_SUBMITTED`, `MILESTONE_APPROVED` and `MILESTONE_CHANGES_REQUESTED` the click target is `/contracts?contractId=<id>` built from `metadata.contractId`. The generated type is `metadata: { [key: string]: unknown } | null`, so the id is narrowed to a non-empty string and any other value falls back to the link rules. `CONTRACT_WITHDRAWN` carries no metadata in the API, so it falls back to `/contracts` (it is a freelancer notice, the client never receives it). `notificationHref(type, link, metadata)` takes the metadata as a third argument (`use-notifications.tsx` passes it).
- `contractErrorMessageOf` moved from `contracts-dashboard.tsx` to `lib/contracts.ts` with a test.
- Spec gaps recorded under Known limitations: no single-contract read, no single-proposal read, no client reject or un-shortlist for proposals, no client decline for contracts, no idempotency key on contract operations.

### Known limitations (spec gaps, client app)

- No single-contract read: `?contractId=` opens a contract only when it is on the loaded page.
- No single-proposal read: a proposal is shown only from its job's list page.
- No client reject or un-shortlist operation for proposals.
- No client decline operation for contracts (decline is talent-only; the client can only withdraw a `PENDING` offer).
- No idempotency key on any contract operation; double submits are stopped only by the UI lock and the API's state guards.
- No single-conversation read: `?conversationId=` opens a conversation only when it is within the loaded inbox pages (20 to 100 rows, "Load more threads").

## Batch 3f result

- Operations used (all through `@onemarketplace/api-client`): `messaging_get` (inbox, `limit` and `offset`, answers `{ results, hasMore, totalUnread }`), `messaging_get_by_conversation_id_messages` (cursor, `limit` 30, answers `{ results, nextCursor }`), `messaging_post_by_conversation_id_messages` (send, camelCase attachment `{ fileUrl, fileName, fileSize, mimeType }`), `messaging_post_by_conversation_id_read` (`lastReadMessageId`), `messaging_post_by_conversation_id_meetings`, and `contracts_patch_by_contract_id_milestones_by_milestone_id_review` for approving or requesting changes from the thread. Hooks are in `app/hooks/use-messages.ts`; mappers, dedupe, reconcile, cache updates, attachment and error helpers are in `lib/messages.ts` (tests: `lib/messages.test.ts`). The inbox comes from web-core `useConversations` (same query as the header badge); `useUnreadMessages` in the app now only returns its `totalUnread`.
- One shared socket: `messages-dashboard.tsx` no longer opens its own socket or reads the Clerk `userId`. `useMessagingSocket()` (function-form auth, one connection per tab, shared with `SessionEffects`) supplies status, typing and `setTyping`. Sender checks use `actorId` from `useAccount()` (the public account id, also for typing); `presenceId` is not needed because the screen shows no presence (see below). The old `["client-conversations"]` and `["conversation-messages", id]` keys are gone; messages use `queryKeys.conversationMessages(role, scope, id)`, so the socket's `conversation:update` invalidation and the reconnect refetch reach the thread.
- Sound: the `/messages` special case is removed. `SessionEffects` plays the sound for every `conversation:update` with `messagesChanged` from someone other than me, on every page (`shouldPlayMessageSound`). `message-sound.ts` keeps only `messageSound`; `unlockMessageSound` (unused) and `playIncomingMessageSound` are removed.
- Reconnect: web-core invalidates every query under `queryKeys.conversationsAll` on a reconnect (not the first connect). The inbox and the thread are under that prefix, so both refetch; a thread refetch reloads the loaded pages and `flattenMessagePages` dedupes by id (a new message shifts the cursor, so pages can overlap). The screen shows a "Reconnecting…" note while the socket is closed or in error.
- Optimistic send: a placeholder (`optimistic-...`) is added to the newest page and the inbox preview is updated; on success `reconcileSentMessage` replaces the placeholder with the server message, or only drops it if a refetch already delivered the server id, or appends the server message if a refetch removed the placeholder. On failure the placeholder is removed, the text returns to the composer and the error (with its reference) is shown above the composer. A ref lock rejects a second send in the same tick.
- Read state: the thread calls `POST /conversations/{id}/read` once per last server message id while the open conversation has unread messages (the socket event `conversation:read` is not exposed by web-core, so REST is used). The inbox cache is cleared optimistically and set from the answer.
- Money: milestone and contract cards read `amountCents` and `firstMilestone.amountCents` from the event payload (the old code read a dollar `amount` that the API never sent, so amounts showed as $0) and show them with `formatCents`. `ClientMessage` in `client-data.ts` uses `amountCents` and `bidCents`; `ClientConversation.id` is a string and `online` is gone.
- Camel case and envelope: attachments are `fileName`, `fileUrl`, `fileSize`, `mimeType` (they were read as snake_case, so attachments never showed). Errors go through `ApiError` and `errorMessage` with `(reference <requestId>)`. The freelancer delivery link, the meeting join url and attachment links are shown only when `isHttpsUrl` accepts them.
- Stopped, not invented: presence. `presence:snapshot` and `presence:update` carry public ids (account id, agency id in agency scope), but `MessagingParticipant` in the generated types has no `accountId` or `agencyId` (only `name`, `avatarUrl`, `participantType`, `companyName`, `professionalTitle`), so the counterparty cannot be matched to a presence id. The online dot and the "Online" or "Offline" text were removed; the header shows the account type. To bring it back the API needs `accountId` and `agencyId` on the conversation participant. Typing works: `typing:update.userId` is the account id, so any typing id other than `actorId` is the other side.
- Starting a conversation: from a proposal it is the interview operation (3d, `POST /proposals/{id}/interview`), which lands on `/messages?conversationId=`. From a profile the operation exists (`POST /conversations` with `recipientId`, `jobId`, `proposalId`; client only) but the client app has no profile "Message" button yet; the public profile pages are 3g. Not added here.
- Known limitations: the inbox loads 20 conversations and "Load more threads" raises it to at most 100; a conversation outside those rows shows "Conversation does not exist" (no single-conversation read). Messages load 30 at a time (older pages on scroll up). Attachments are sent as base64 data urls (the API contract), at most 5 MB and the five types the API allows. Not verified against a running API or a browser. Five-rule warnings in the client app: 0 in every file touched.

### Test conversation for 3f (only existing API operations, DEFERRED)

Two actors are needed (the client and a freelancer) and the freelancer app cannot start or answer conversations yet, so the live check is deferred. Each step was checked against the API code (`messaging.route.ts`, `messaging.conversations.service.ts`, `messaging.messages.service.ts`); none was run. Use the Swagger UI as in "Test data for 3d" (server `http://localhost:4000/api/v1`).

1. Freelancer: have a signed-up freelancer account (as in 3d, steps 2 to 4). With its token, `GET /auth/status?role=freelancer` returns `accountId`; copy it.
2. Client: with the client's token (Authorize again), `POST /conversations?role=client` with `{ "recipientId": "<freelancer accountId>", "jobId": "<one of your job ids, optional>" }`. It is client only (`requireClient`); a `recipientId` that is not a freelancer answers 404, your own id 400, a `jobId` you do not own 404. It answers 201 with the conversation, including its `id`. Calling it again returns the same conversation (one per client, freelancer and job). Alternatively start it from a proposal in the client app (3d, Start interview), which needs the proposal test data.
3. Open `http://localhost:3001/messages?conversationId=<id>`.
4. Freelancer replies: with the freelancer token, `POST /conversations/<id>/messages?role=freelancer` with `{ "body": "Hello from the freelancer" }`. For a typing or presence check you need a second socket client, which the freelancer app does not offer yet.

### Manual QA checklist (owner) for 3f

Prepare as above. DEFERRED until the freelancer app can start conversations.

1. `/messages` lists your threads with the freelancer name and avatar or initials, the job title, the last message and a relative time. With none: "No project threads found.". With the API stopped an error message shows instead of a blank page. The header unread badge and "N unread messages" use the same number.
2. Open a thread: messages load (30 at first), yours on the right as client and theirs as talent; scroll to the top loads older ones without a jump or a duplicate.
3. Send "hello": it appears at once, then stays once (no second copy after the reply arrives); Enter sends, Shift+Enter adds a line. Stop the API and send: the text returns to the box and an error with a reference shows above the composer.
4. Freelancer reply (test conversation step 4): it appears without reloading, the sound plays once on this page and on other pages, and the thread unread count drops to 0 after it is open. A reply while you are on another page raises the header badge.
5. Typing: with a second socket client typing in the same conversation the header shows "Typing...". The online dot is gone by design (see the presence gap).
6. Attachment: PDF, DOCX, PNG, JPG and TXT up to 5 MB send; another type or a larger file is refused with the message in the dialog. The attachment shows its name and size.
7. Reconnect: stop the API for about 20 seconds with the thread open; the "Reconnecting…" note shows. Send a freelancer message through Swagger after restarting the API; the thread and the inbox refetch on reconnect and the message appears once.
8. Meetings: Create meeting opens the Daily room (https only) and pauses the chat; Join meeting opens the same room. An API error shows above the composer with a reference.
9. Contract events: an offer card shows the first milestone amount as `$1,500.00`-style text (cents formatted, not $0); a submitted milestone shows Accept work and Request changes; both call the review operation once, show an API error with a reference in the dialog and update the card after the refetch.
10. Only one `GET /notifications/stream` and one websocket connection exist per tab (DevTools, Network), also while `/messages` is open.

## Batch 3g result

- Operations used: `client_get_dashboard_overview` (home), `client_get_marketplace_search` (`query`, `type` all, freelancer or agency, `limit` 20, `offset`; `{ results, hasMore }`), `freelancer_get_profile_by_id` and `agency_get_profile_by_id` (public profiles). Hooks and keys are in `app/hooks/use-profiles.ts`; pure helpers are in `lib/profiles.ts` (tests: `lib/profiles.test.ts`). No raw `fetch(` and no `NEXT_PUBLIC_SERVER_URI` are left outside `app/provider.tsx`.
- Home: `totalSpentCents`, `currentlyFundedCents` and `activeJobPosts[].budgetCents` are formatted with `formatCents` and `formatCompactCents`; a load failure shows the API message with its reference.
- Search: the account filter is the spec enum (`all`, `freelancer`, `agency`) and results use `accountType` `FREELANCER` or `AGENCY`. The old code compared against `"Agency"`, so agencies linked to `/talent/<id>`; they now open `/agency/<id>`. An error state replaces the silent empty list. The spec has no budget or rate parameters on this operation (the `minRateCents` and `maxRateCents` filters belong to `freelancer_get_search` and `agency_get_search`, which the client UI does not use).
- Profiles: both pages are now thin server shells around client views (`profile-views.tsx`) with loading, not-found and error states. Everything is camelCase from the generated types; `hourlyRateCents`, `amountCents` and `totalEarningCents` go through `formatCents`; the old `professional_title`, `hourly_rate` and `cover_image` reads (which showed `NaN` or threw on portfolios) are gone. Portfolio links, avatars and cover images are shown only when `https:`.
- Paging: the API returns `workHistory`, `portfolios` and `members` as whole arrays (no cursor), so they are paged in the UI with `paginate` (clamped, empty-safe): completed work 2 per page, ongoing projects 3 per page (new, it had none), team members 4 with "Show more". Ongoing projects show the start month only where the type has `createdAt` (freelancer profiles).
- Status: `ACTIVE` and `COMPLETED` work are separated explicitly; only completed work reviewed by both sides with a rating is listed as feedback. A rating of `null` shows `N/A`.
- STOPPED, not invented (item 3, profile "Message" button): `POST /conversations` needs `recipientId`, the public account id (`findAccountByPublicId`). `FreelancerPublicProfile.id` and `ClientMarketplaceResult.id` are the profile id (`freelancer_metadata.id`, the id of `GET /freelancer/profile/{id}`), and no public profile or search type exposes the account id (`PublicAgencyProfile` has no account id either, only `members[].id` and `profileId`). Needed from the API: an `accountId` on `FreelancerPublicProfile`, `PublicAgencyProfile` (owner) and `ClientMarketplaceResult`, or accepting the profile id as a recipient. Conversations are still started from a proposal interview.
- Removed on the way: `talent` page's mapping into the mock `ClientProposal` type, `online` and `bid` on profiles, `window.location.assign` for the account menu (now `router.push`).
- Review fixes: `companyWebsite` and existing job attachment links are rendered only when `https:`; two ids in internal links are URL-encoded.

### Client app done (end of batch 3)

- `client-dashboard` left `unmigratedApps` (`packages/eslint-config/next.mjs`, approved in the batch prompt). ESLint on the app: 0 errors, 1 warning (`@next/next/no-img-element` in `settings-client.tsx`, not one of the five rules); 0 warnings for the five rules.
- Part 0: the add-milestone maximum is 100,000,000 cents like the job milestone maximum (was `Number.MAX_SAFE_INTEGER`). Backend gap: the add-milestone schema has no sane upper bound. Form copy (job title, description, milestone title, attachments, budget input minimum, message attachment hint, avatar size) is derived from lib constants, with tests.
- Tier 2: format check (`--end-of-line auto`), `pnpm -r lint` (0 errors), `pnpm -r typecheck` (clean), tests (client 183, web-core 76, api-client 103), production build of the client app with a dummy Clerk key pair and `NEXT_PUBLIC_SERVER_URI=http://localhost:4000/api/v1`, `docs/api/openapi.json` unchanged (sha256 `bcbe56aa52b5165c910ffc136b6e1ba576d13e6131cf37c193f8cb809abb3861`, no git diff).
- Open items from the reviewer (not blockers): `next.config.ts` had no `images.remotePatterns` (fixed in [Cleanup and extraction](#cleanup-and-extraction-after-3g)); several internal hrefs interpolate uuids without `encodeURIComponent`; `proposals-dashboard.tsx` logs the mapped message with `console.error`.

### Manual QA checklist (owner) for 3g

1. Home `/`: the four metrics and the active job list show `$` amounts with cents rules (compact for totals); with the API stopped a red message shows.
2. Press Ctrl+K: search lists results 20 at a time and loads more on scroll; the Talent and Agency filters narrow the list; a Talent result opens `/talent/<id>` and an Agency result opens `/agency/<id>`; with the API stopped the modal shows "Search is unavailable".
3. `/talent/<id>`: name, title, location, rate as `$75.00/hr`, rating, availability, languages, skills, portfolio, ongoing projects and completed work. With more than 2 completed reviewed jobs the pager shows "Page 1 of N" and the buttons stop at both ends; with more than 3 active jobs the ongoing list pages too.
4. `/talent/<unknown uuid>` shows "Talent profile not found."; `/talent/not-a-uuid` shows the API validation message with a reference.
5. `/agency/<id>`: team (4 shown, "Show N more members"), portfolio, completed work. A member with a profile opens `/talent/<profileId>`; one without does nothing.
6. A portfolio link that is not `https:` is not rendered (check with a test row), and there is no Message button on profiles (see the stopped item).

## Cleanup and extraction after 3g

- Cleanup: removed the unused types `ClientJob`, `ClientProposal`, `CompletedClientContract` and `JobStatus` (`client-data.ts`), `DashboardNotification`, `JobPostSaved`, `JOB_LOCKED_CODE`, `MAX_MILESTONES`, `isContractConflict` and `MessageAttachmentItem`, each checked unused with grep first. `socket.io-client` stays in `package.json`: it is a peer dependency of web-core and the consuming app provides it.
- Images: every `next/image` use is remote (Clerk user avatars; API avatars and portfolio covers). `next.config.ts` now has `images.remotePatterns` for `img.clerk.com` (the host `@clerk/shared` builds its image urls on) and `ik.imagekit.io` (the API uploads to ImageKit and stores the `url` ImageKit returns; the repo sets no custom endpoint, so this is the SDK's default delivery host). If the ImageKit account uses a custom domain, add that host.
- Verified, `notification.href`: every path goes through `presentNotification` then `notificationHref`, which returns either the fixed route base or the `pathname` plus `search` of a link that starts with `/`, is not protocol relative, parses to the same origin and stays under the route base. The header and the notifications page render only that value. No change needed.
- Verified, message attachment limits (API, read only): at most 5 attachments per message (`services/api/src/shared/uploads/constants/attachments.constants.ts:2`, schema `modules/messaging/schemas/messaging.schema.ts:75-78`), 5 MB each (`attachments.constants.ts:1`, checked in `shared/uploads/attachments.ts:126`), 14 MB in total (`attachments.constants.ts:3`, `attachments.ts:134`), base64 length capped before decoding (`attachments.constants.ts:17`, `attachments.ts:38`), and the route body parser allows 20 MB (`middleware/constants/json-body.constants.ts:5`, `modules/messaging/messaging.route.ts:46`). The client app sends one file of at most 5 MB per message, inside the API limits.
- Extraction into `packages/web-core` (the client app imports them from `@onemarketplace/web-core`): `url` (`isHttpsUrl`), `money-input` (`toCents`, `centsToFormAmount`, `validateMoneyInput`), `account-gate` (`decideAccountGate`, now with `expectedRole` and `onboardingPath` parameters), `profiles` (paging, work history, formatters, `safeHttpsUrl`, `profileErrorMessage`, `isProfileNotFound`), `profile-hooks` (`useTalentProfile`, `useAgencyProfile`), `messages` (cursor paging, optimistic send, cache updaters, attachment rules, sound and typing helpers), `message-hooks` (`useConversationMessages`, `useSendMessage`, `useMarkConversationRead`, `useStartMeeting`) and `contracts` (types, `milestoneState`, totals, `nextDeadline`, `startedAt`, checkout url guard, `contractErrorMessage`). The public profile query keys are now `["web-core", "profiles", "talent" | "agency", id]` (were `client-talent-profile` and `client-agency-profile`), so `resetWebCore` clears them on sign out.
- Left in the app: the public profile components (UI, Next `Link` and `Image`, client routes), `toConversationView` and `toThread` (client wording and routes), contract labels, tones and action rules (client perspective), `useLockedMutation` and the client hooks, `notification-routes` (route table per app), `session-boundary` (Clerk and Next), and the job bounds and form rules.
- Known limitations: the moved message and contract hooks have no component tests (they had none in the app); only the public profile hooks got new tests. The app files that are now unused stay on disk until the owner deletes them.

## Client dashboard full QA

One end-to-end order for the client app. Flows marked WAITS need the freelancer app (or Swagger acting as the freelancer, see "Test data for 3d"). Nothing here has been run against a live API yet.

1. Onboarding (3a, 3b): sign up a client, land on `/profile/edit`, save the profile, reach the dashboard, sign out and in again without passing `/profile/edit`. Checklists 3a and 3b.
2. Settings (3b): company form, finances link (Stripe), identity verification (Stripe Identity).
3. Jobs (3c): create with two milestones, save a draft, edit, paginate, delete. Checklist 3c.
4. Search and profiles (3g): open Ctrl+K, find a freelancer and an agency, open both public profiles. Checklist 3g. WAITS for freelancer data: create a freelancer and an agency profile first (freelancer onboarding through Swagger, 3d test data).
5. Proposals (3d): WAITS for the freelancer app (a freelancer submits a proposal; Swagger can stand in). View, shortlist, start an interview. Checklist 3d.
6. Contract offer with Stripe test mode (3d step 8 and 3e): "Send contract offer", pay with `4242 4242 4242 4242`, webhook through `stripe listen`. WAITS: the freelancer must accept the offer (Swagger `PATCH /contracts/{id}/accept`) and can decline it.
7. Milestones (3e): fund a milestone through Stripe, WAITS for the freelancer to submit it, then request changes, approve, add a milestone, finish and review the contract. Checklist 3e.
8. Messages (3f): the interview thread, send and receive, attachments, meetings, reconnect. WAITS for a second actor for replies, typing and presence (presence is not shown, API gap). Checklist 3f.
9. Notifications (3a): after steps 5 to 8, each notice marks as read and opens its target (`/contracts?contractId=`, `/proposals/<jobId>`, `/messages?conversationId=`). The bell and one stream per tab hold throughout.
10. Sign out: stream and socket close, no API calls follow.

Spec gaps that limit this QA: no single-contract, single-proposal or single-conversation read; no client reject, un-shortlist or decline; no idempotency key on contract operations; no presence id on conversation participants; no account id on public profiles (no Message button); add-milestone has no sane upper bound in the API schema.
