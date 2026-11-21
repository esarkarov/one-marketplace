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
| 3     | client                                                                                                                                             |
| 4     | freelancer                                                                                                                                         |
| 5     | agency                                                                                                                                             |
| 6     | landing                                                                                                                                            |
| 7     | Decline and withdraw actions and `CANCELLED` badges in all dashboards                                                                              |

Order rationale: admin is the closest match to the contract, so it proves the api-client cheaply. Client is on the revenue critical path (job posting, checkout, funding). Freelancer and agency share code, so agency follows freelancer and reuses it. Landing is last because it only does sign-up and redirects.

Lint override: until an app is migrated, `packages/eslint-config/next.mjs` downgrades five rules to warnings for `agency-dashboard`, `client-dashboard` and `freelancer-dashboard` only: `@typescript-eslint/no-explicit-any`, `react-hooks/set-state-in-effect`, `react/no-unescaped-entities`, `@typescript-eslint/no-non-null-asserted-optional-chain` and `react-hooks/purity`. An app's entry is removed from that list in the app's last sub-batch, and that batch must leave the app at 0 warnings for these five rules. While migrating, any file a batch rewrites or touches must be cleared of these warnings.

## Status

- 2026-11-20: batch 0 done.
- 2026-11-20: batch 1a done: `packages/api-client` (generated types and operation metadata, typed fetch client with auth, role and scope injection, error envelope handling, money and date formatters). No app uses it yet; the notification and socket hooks, the auth helper and the app wiring remain in batch 1.
- 2026-11-20: batch 2 done (admin): see [Batch 2 result](#batch-2-result). Not yet verified against a running API or a browser.
- 2026-11-20: batch 1b done: `packages/web-core` (`@onemarketplace/web-core`: `ApiProvider` and `queryKeys`, `useAccount`, one shared notification stream per tab with reconnect, backoff and refetch, notifications list and optimistic mutations, one shared messaging socket with a fresh token per handshake, unread counts, sound player). No app uses it yet; the app wiring stays in the app batches.
- 2026-11-20: batch 3a done (client foundations): see [Batch 3a result](#batch-3a-result). Not yet verified against a running API or a browser. Sub-batches 3b to 3e (jobs, proposals, contracts, messages, profile, settings, search) are open; `client-dashboard` stays in `unmigratedApps` until 3e.
- 2026-11-21: batch 3b done (client onboarding, profile and settings): see [Batch 3b result](#batch-3b-result). Not yet verified against a running API or a browser.
- 2026-11-21: batch 3c done (client jobs): see [Batch 3c result](#batch-3c-result). Not yet verified against a running API or a browser.

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
- `proxy.ts` keeps Clerk authentication and the signed-out redirect to the landing page and makes no network call. The `/api/me` self-fetch is gone; its decision now lives in `AccountGate` (`app/session-boundary.tsx`) over `GET /auth/status` (same query key as `useAccount`, one request): failed check, no account or a role other than `client` go to the landing page; a client that is not onboarded goes to `/profile/edit` (allowed there); otherwise the page renders. The decision is the pure function `decideAccountGate` in `lib/account-gate.ts`. `app/api/me/route.ts` is unused.
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
- Left for later: `client-header.tsx` and `client-sidebar.tsx` still fetch `/client/profile` by hand under the same query key, and `app/api/me/route.ts` is unused. The completed-contracts list shows the first 50 only (`hasMore` is ignored). The Notifications settings toggles are local only (no API). Public profiles stay in 3f.
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
- Known limitations: the spec has no close or cancel operation for a job, so none was added (a published job can only be edited or deleted; a hired job is locked). The proposals page sees at most the first 100 jobs. Not verified against a running API or a browser. Five-rule warnings in the client app: 11 before, 9 after (header and sidebar no longer have any; `proposals-dashboard.tsx` keeps 6). Typecheck reports only a stale `.next/types/validator.ts` reference to the removed `app/api/me/route.js`; delete the local `apps/client-dashboard/.next` folder to clear it.

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
