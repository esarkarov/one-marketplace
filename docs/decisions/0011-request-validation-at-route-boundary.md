# 0011: Request validation at the route boundary

Status: accepted (Stage 9a). Closes finding L3 of ADR 0008.

## Context

Audit finding L3 (ADR 0008): most routes had no zod schema and missing max lengths. Of 100 routes, 19 validated with zod at the route, 44 parsed input by hand in controllers, and 32 had no validation. Eleven routes could return 500 when `:id` was not a UUID, because the raw value reached a Postgres `uuid` column. Hand-written checks drifted: some had no length caps, some coerced strings to numbers or booleans, and some ignored unknown keys.

## Decision

1. One middleware, `validate({ params, query, body })` in `services/api/src/middleware/validate.middleware.ts`, applied on each route. Schemas live in `src/modules/<module>/<module>.schemas.ts`. Limits live only in `src/utils/validation-limits.ts`. Shared zod pieces (`uuidParam`, `uuidParams`, `boundedText`, `pagingDigits`, `withIgnoredKeys`, `roleField`) live in `src/utils/common-schemas.ts`.
2. Objects are strict by default (`z.strictObject`). An unknown key is a 400, except for the stripped keys in item 6.
3. The schemas are attached to the handler under a symbol and read back with `getValidationSchemas`. A later stage (9b) can generate OpenAPI from them. No OpenAPI library is chosen by this ADR.
4. Every `:id` parameter is `z.uuid()` through `uuidParam` or `uuidParams`.
5. An optional `role` (`client` or `freelancer`) is allowed on every authenticated body and query, so clients that already send it keep working. Public routes (freelancer and agency `GET /profile/:id`, `POST /auth/sign-up`, the public jobs feed and the public talent and agency searches) use an empty strict query or one without `role`, so a `?role=` there is a 400.
6. Only `id`, `imageId`, `createdAt` and `updatedAt` are stripped (accepted and dropped, not rejected) on PUT profile, agency, job and client profile bodies. Clients send these back after reading the resource. No other key is stripped.
7. Bodies take their exact types, with no coercion. Only query strings and params are coerced.
8. An invalid `scope` value is a 400.
9. `limit` and `offset` keep the controller clamping. The schema accepts digits only, up to 10 digits, and the controller still clamps to its own maximum.
10. Middleware order is authentication, route-level role middleware, `validate`, controller. A 401 or 403 from route middleware therefore comes before a 400. Where the role-mismatch check runs in the controller, `validate` runs first, so a 400 comes before that 403 (see "Order of checks").
11. The 400 response body is `{ success: false, message, code: "VALIDATION_ERROR", errors: [{ path, message }] }`. `message` is the first issue's text. `errors` is capped at 50 entries. A `path` starts with `params`, `query` or `body`, and an unknown key's name appears in the path. Raw input values are never echoed. A schema may set its own message; otherwise a default message per issue code applies (`Unknown field.`, `Required.`, `Invalid type.`, `Value is out of the allowed range.`, `Invalid format.`).
12. Registry test `src/routes/route-validation.test.ts` walks every registered route and fails when a handler has no validation schema and is not listed in `src/routes/validation-allowlist.ts`. Each allowlist entry has a written reason. Seven POST or PATCH routes that read no body are listed in `bodylessRoutes` in the same file, also with reasons (they currently accept and ignore any JSON body). Routes that run `validate` before any other handler are listed in `publicRoutes`, also with reasons. The registry also fails when `validate` is the last handler of a route, when a nested router is mounted without a path, and when a params, query or body schema is not a strict object (`z.any`, `z.record`, loose or stripping objects). Router-level middleware registered before a route counts as running before `validate`. The allowlist holds:
    - Stripe webhooks for connects, contracts and identity: raw body and Stripe signature check, no zod after parsing.
    - The Daily meetings webhook: raw body and HMAC check, no zod after parsing.
13. Base64 attachment handlers validate the JSON shape and the string length caps at the route. Decoding, MIME type and magic-byte checks, and the size totals stay in `validateAttachmentBatch` (`src/utils/attachments.ts`).

## Order of checks

Where the role check is route middleware, a wrong or missing role gets 401 or 403 before any 400.

Only the controller's role-mismatch 403 comes after the 400: a request with an invalid body gets 400 before that 403. The 403 from `resolveAccountRole` for a missing account on `isAuthenticated` routes still precedes validation (`src/routes/validation-order.test.ts`). These routes are pinned:

- Proposals: `POST /`, `PATCH` status, `POST` interview.
- Contracts: every authenticated route except `GET /client`.
- Messaging: `POST /`.
- Connects: `POST /checkout`.
- Jobs: `GET /`, `GET /:jobId`, `DELETE /:jobId`, the saved routes, `POST /`, `PUT /:jobId`.
- Freelancer: profile, earnings, payouts connect-link, jobs, `PUT` profile.
- Client: every route.
- Agency: every authenticated route.
- Auth: `POST /sign-up` has no authentication middleware (the token is checked in the controller), so a bad body without a token gets 400 before 401.

On every other route above, a missing or invalid token is still 401, because authentication runs first.

## Limits

Source: `services/api/src/utils/validation-limits.ts` (authoritative). Values marked **existing** were in use before stage 9a, as the comment in that file says. Every other value is **new** and **provisional** until the frontends are wired to the API and the values are confirmed against real input.

- Attachments (existing): `MAX_ATTACHMENT_BYTES` 5 MiB (5242880), `MAX_ATTACHMENTS` 5, `MAX_TOTAL_ATTACHMENT_BYTES` 14 MiB, `MAX_ATTACHMENT_FILE_NAME_LENGTH` 255, `MAX_ENCODED_LENGTH` 6990508 (derived from the byte limit), `MAX_DATA_URL_HEADER_LENGTH` 512 (defined in `attachments.ts`, re-exported).
- Search (existing): `SEARCH_QUERY_MAX_LENGTH` 100, `SEARCH_OFFSET_MAX` 10000.
- Live URL (existing): `MAX_LIVE_URL_LENGTH` 2048.
- Common: `email` 254 (existing); `pagingDigits` 10, `scope` 32, `attachmentFileId` 255 (new). The unused `url`, `context`, `role` and `dataUrlHeader` entries were removed.
- Admin: `redisPattern` 64 and `redisKey` 128 (existing); `password` 1024, `streamToken` 2048 (new); the unused `pagingDigits` was removed.
- Messaging: `body` 10000 (existing); `recipientId` 64, `cursor` 512, `attachmentMimeType` 127 (new).
- Jobs (all new): `titleMax` 100, `descriptionMax` 5000, `skillsMaxItems` 30, `skillMaxLength` 50, `screeningQuestionsMaxItems` 10, `screeningQuestionMaxLength` 500, `milestonesMaxItems` 20, `milestoneTitleMax` 120, `milestoneDueDateMax` 32, `milestoneIdMax` 64, `feedLevelsMax` 256, `feedSortMax` 32, `expertiseLevelMax` 50, `expectedDurationMax` 50, `statusMax` 50.
- Proposals: `interviewMessageMax` 5000 (existing); `coverLetterMin` 80, `coverLetterMax` 10000, `screeningAnswersMaxItems` 10, `screeningAnswerMaxLength` 5000, `durationMax` 50 (new).
- Contracts: `milestoneRequirementsMax` 500, `milestoneTitleMin` 3, `milestoneTitleMax` 120, `reviewCommentMin` 10, `reviewCommentMax` 1000, `ratingMin` 1, `ratingMax` 5 (existing); `submissionMessageMin` 10, `submissionMessageMax` 5000, `feedbackMax` 5000, `submissionDeliveryLinkMax` 2048 (new).
- Freelancer: `skillsMinItems` 3, `skillsMaxItems` 15, `skillMaxLength` 20, `languagesMinItems` 1, `languagesMaxItems` 5 (existing); `professionalTitleMax` 100, `professionalDescriptionMax` 5000, `countryMax` 100, `cityMax` 100, `availabilityMax` 50, `weeklyAvailabilityMax` 50, `experienceLevelMax` 50, `languageMax` 50, `proficiencyMax` 50, `portfolioMaxItems` 10, `portfolioTitleMax` 100, `portfolioCategoryMax` 100, `portfolioDescriptionMax` 2000, `websiteMax` 2048, `decimalFilterMax` 10 (new).
- Agency (all new): `nameMax` 100, `professionalTitleMax` 100, `specialtyMax` 100, `sizeMax` 50, `memberRoleMax` 50, `overviewMax` 5000, `tagsMaxItems` 15, `tagMaxLength` 20, `portfolioMaxItems` 10, `portfolioTitleMax` 100, `portfolioCategoryMax` 100, `portfolioDescriptionMax` 2000, `websiteMax` 2048.
- Client (all new): `searchTypeMax` 32, `professionalRoleMax` 100, `companyNameMax` 100, `industryMax` 100, `companySizeMax` 50, `companyDescriptionMax` 5000, `websiteMax` 2048.

Note: the attachment type cap is `MESSAGING_LIMITS.attachmentMimeType` (127), shared by messaging and jobs. A DOCX MIME type is 73 characters, so a cap of 50 would reject valid files.

## Client-visible changes

Every endpoint below now answers 400 where it used to accept or coerce the input. No endpoint changes its success shape.

- Jobs: unknown keys; non-UUID ids; non-string text fields in the job body; numbers inside `skills` and `screening_questions`; a string `fileSize`; array or object query values on the public jobs feed; non-digit `offset` and `maxProposals` on the public jobs feed, and non-digit `minProposals` and `maxProposals` on the authenticated feed; `paymentVerified`, `verifiedOnly` and `availableOnly` values other than `"true"` or `"false"`; over-length values per the limits above.
- Proposals: `isShortlisted` when not boolean; `screeningAnswers` with non-string items or more than 10 items; unknown keys.
- Contracts: `rating` sent as a string; unknown keys; over-length review and submission text.
- Connects: `connects` sent as a string; unknown keys.
- Agency: the `accept` flag on invitation respond when not boolean; `connects` sent as a string; `paymentVerified` other than `"true"` or `"false"`; `minProposals` and `maxProposals` that are not digits; unknown keys; over-length profile values.
- Freelancer: unknown keys; non-UUID ids; over-length profile and portfolio values; `paymentVerified` other than `"true"` or `"false"`; non-digit paging values.
- Client: unknown keys and over-length profile values on every route.
- Identity: `context` other than `agency`.
- Messaging: `body` and `attachments` set to `null` are accepted as empty; attachments with extra keys; an over-length `body`, `cursor` or `recipientId`; attachment `mimeType` over 127.
- Meetings and notifications: unknown keys and non-UUID ids.
- Auth: `POST /sign-up` requires a valid `role` in a strict body.
- Admin: login with a missing or non-string `password` now answers 400 instead of 401.
- Scope: a `scope` value outside the allowed list answers 400 on every route that takes one.
- Previously accepted `null` values stay accepted: agency `website`, `professionalTitle`, `avatarImage`, `tags` and `portfolio`; job `skills`, `screening_questions`, `attachments`, `status`, attachment `fileId` and `fileSize`; messaging `body` and `attachments`. A numeric job milestone `id` is accepted again.
- A read-modify-write PUT body that echoes GET fields other than `id`, `imageId`, `createdAt` and `updatedAt` now gets 400 (unknown field). Agency GET also returns `isOnboarded`, `members`, `ownerLocation`, `ownerLanguages`, `ownerLanguageDetails`, `stats` and `workHistory`. Freelancer and job rows are snake_case (`auth_id`, `created_at`, `updated_at`, `freelancer_id`, `client_id`, `total_budget_cents`) with `proposalCount` and `hireCount` on jobs. Client metadata returns `joinedAt`, `identityVerified`, `paymentMethodVerified` and `isOnboarded`. Clients must send only editable fields.

## Open items

- Decided: the ignore lists are not extended per resource. Only `id`, `imageId`, `createdAt` and `updatedAt` are stripped.
- The GET response shapes are inconsistent (camelCase and snake_case) and will be reviewed in the OpenAPI stage (9b).
- Socket.io events are out of scope for this ADR. Inbound `typing:set` and `conversation:read`, and outbound `presence:snapshot`, `presence:update`, `typing:update` and `conversation:update`, are not validated by `validate`. They need their own decision.
- `sort`, `filter`, `type` and `memberRole` are still bounded strings with a controller fallback. They are candidates for enums.
- Agency `POST /` (create) does not use `withIgnoredKeys`, so it does not strip the four keys in item 6.
- Rows stored above a new cap cannot be saved again until they are shortened. No migration is made for them.
- No app calls the API yet, so client compatibility is not verified. The new limits stay provisional until the frontends are wired.
