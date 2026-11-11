# Test plan: API request validation (Stage 9a)

## Scope

- `validate` middleware (`services/api/src/middleware/validate.middleware.ts`), the per-module `<module>.schemas.ts` files, `src/utils/validation-limits.ts`, `src/utils/common-schemas.ts`, the registry test and the allowlist (`src/routes/validation-allowlist.ts`). Design: `docs/decisions/0011-request-validation-at-route-boundary.md`.
- Every route in `services/api` (100 at the time of the audit), with the Stripe and Daily webhooks checked only for their raw-body and signature handling.
- Base64 attachment handlers: the JSON shape and string caps at the route; decoding, MIME and magic bytes stay in `validateAttachmentBatch`.

Use only the `_test` database with Clerk, Stripe, ImageKit and Daily mocked. Never use or print the real `.env`.

## How to run

```
pnpm --filter @onemarketplace/api test:quiet src/routes
pnpm --filter @onemarketplace/api test:quiet src/modules/jobs/jobs.validation
pnpm --filter @onemarketplace/api test:quiet
```

The full suite runs once at the end of the step group. Use the scoped commands for each step.

## Test files

| File                                               | Covers                                                                                                                                                                                                                                                                                                                                                                                                                                                            | Status             |
| -------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------ |
| `src/middleware/validate.middleware.test.ts`       | Middleware: part order, 400 shape, 50-entry cap, unknown key in path, no raw value echoed, default messages, schemas attached to the handler                                                                                                                                                                                                                                                                                                                      | On disk            |
| `src/modules/<module>/<module>.validation.test.ts` | Table-driven per route: valid body passes, each invalid case gets 400 with path and code. Modules: jobs, freelancer, client, agency, auth, admin, proposals, contracts, messaging, meetings, notifications, connects, identity                                                                                                                                                                                                                                    | On disk for all 13 |
| `src/routes/health.validation.test.ts`             | Route-level checks, currently the health route                                                                                                                                                                                                                                                                                                                                                                                                                    | On disk            |
| `src/routes/validation-order.test.ts`              | Cross-module order: 401 before 400 for each auth middleware kind, 403 (no account for the role) before 400, authenticated invalid request reaches validation                                                                                                                                                                                                                                                                                                      | On disk            |
| `src/routes/route-validation.test.ts`              | Registry: every registered route has a validation schema or an allowlist entry with a reason; allowlist is exactly the 4 webhooks and has no stale entries; seven bodyless routes are listed in `bodylessRoutes` with reasons; `publicRoutes` lists the routes where `validate` runs first; synthetic routers prove each check fails (no `validate`, `validate` first on a non-public route, `validate` last, loose or non-strict schema, pathless nested router) | On disk            |
| `src/routes/uuid-params.test.ts`                   | Every `:param` route (28) gets `not-a-uuid`; a non-UUID id is a 400 with `params.<name>`, never a 500                                                                                                                                                                                                                                                                                                                                                             | On disk            |

## Cases

- **Order, 401 and 403 first.** For each route: no token gives 401 even with an invalid body. Where the role check is route middleware: a wrong role gives 403 even with an invalid body.
- **Order, 400 before 403 on pinned routes.** For the routes in ADR 0011 "Order of checks" (proposals `POST /`, `PATCH` status, `POST` interview; contracts; messaging `POST /`; connects `POST /checkout`; jobs; freelancer; client; agency): a wrong role with an invalid body gives 400, and a wrong role with a valid body gives 403. The 403 for a missing account (`resolveAccountRole`) still precedes validation on `isAuthenticated` routes.
- **UUID ids.** Each `:id` route with a non-UUID value answers 400 with path `params.<name>`. No route answers 500 for a malformed id.
- **Strict objects.** An unknown key gives 400 with the key name in `path`. On PUT profile, agency, job and client profile bodies, `id`, `imageId`, `createdAt` and `updatedAt` are accepted and dropped; any other extra key is rejected.
- **No coercion in bodies.** A string where a number or boolean is expected gives 400: `rating` and `connects` as strings, `isShortlisted` and the agency invitation `accept` flag as non-boolean, `fileSize` as a string, non-string job text fields, numbers inside `skills` and `screening_questions`, `screeningAnswers` with non-string items or more than 10 items.
- **Query coercion.** Only query and params are coerced. `paymentVerified`, `verifiedOnly` and `availableOnly` accept only `"true"` or `"false"`. `offset`, `limit`, `minProposals` and `maxProposals` accept only digits up to 10 digits where a route takes them (the public jobs feed takes `offset` and `maxProposals`). Array or object query values on the public jobs feed give 400.
- **Limits.** For each constant in `validation-limits.ts`, the maximum passes and maximum plus one gives 400. Tests read the constant, not a literal. Minimums are checked where the limits file has one (`coverLetterMin`, `milestoneTitleMin`, `reviewCommentMin`, `ratingMin`/`ratingMax`, skills and languages item counts).
- **Scope and role.** An invalid `scope` gives 400. `role` is optional on every authenticated body and query; a value other than `client` or `freelancer` gives 400.
- **Identity context.** `context` other than `agency` gives 400.
- **Admin login.** A missing or non-string `password` gives 400, not 401.
- **Sign-up.** `POST /auth/sign-up` requires a valid `role` in a strict body. It has no authentication middleware (the token is checked in the controller), so a bad body without a token gets 400 before 401.
- **Public routes.** Freelancer and agency `GET /profile/:id`, sign-up, the public jobs feed and the public searches take no `role`; `?role=` there gives 400.
- **Previously accepted nulls.** Agency `website`, `professionalTitle`, `avatarImage`, `tags`, `portfolio`; job `skills`, `screening_questions`, `attachments`, `status`, attachment `fileId` and `fileSize`; messaging `body` and `attachments` accept `null`. A numeric job milestone `id` passes.
- **Read-modify-write PUT.** A PUT body that echoes GET fields other than `id`, `imageId`, `createdAt` and `updatedAt` gives 400. This is decided; the ignore lists are not extended.
- **Error shape.** The 400 body is `{ success: false, message, code: "VALIDATION_ERROR", errors: [{ path, message }] }`. `message` equals `errors[0].message`. `errors` is capped at 50 entries. A sentinel string sent as an input value does not appear anywhere in the response.
- **Attachments.** Message and job attachments with extra keys give 400. A `mimeType` or `fileType` longer than 127 characters gives 400. A DOCX MIME type (73 characters) passes the length check. Unsupported MIME or bad magic bytes still give the message from `validateAttachmentBatch`, not a schema message.
- **Webhooks.** Stripe connects, contracts and identity, and the Daily meetings webhook: the raw body reaches the handler, and an invalid signature still fails the signature check. No zod runs after parsing on these routes.

## Not verified

- Client compatibility: no app calls the API yet, so the new 400 responses are not checked against any frontend.
- Provisional limits: every value in `validation-limits.ts` not marked existing in ADR 0011 is untested against real input.
- Socket.io events (`typing:set`, `conversation:read`, and the outbound presence and typing events) are outside `validate` and not covered here.
- Real Clerk, Stripe, ImageKit and Daily calls.
- Agency `POST /` create does not use `withIgnoredKeys`, so its stripped-key behaviour differs from the profile PUT routes.
- `sort`, `filter`, `type` and `memberRole` are bounded strings with a controller fallback, not enums.
- Rows already stored above a new cap cannot be saved again until shortened. No test covers this migration path.
