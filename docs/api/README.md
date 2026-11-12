# API contract

`openapi.json` is the OpenAPI 3.1 description of `services/api`. It is generated from the route zod schemas and committed. Do not edit it by hand. See `docs/decisions/0012-openapi-contract-from-zod.md`.

## Regenerate

```sh
pnpm --filter @onemarketplace/api openapi:generate
```

The script runs from source with `tsx`, sets dummy environment values, reads no `.env` and connects to nothing. Output is deterministic (sorted keys, LF), so a second run changes nothing. CI regenerates the file and fails if `git diff` shows a change, so commit the result with any route or schema change.

## Consume

Import `docs/api/openapi.json` into Swagger UI, Redoc or Postman. No runtime endpoint serves it. Typed-client generation is out of scope for now.

## Conventions

- `operationId` is `<module>_<method>_<path words>` in snake case; a path parameter becomes `by_<name>`.
- One tag per module.
- Security: `clerkBearer` (Clerk session token) for authenticated routes, `adminSession` (admin session token) for admin routes, `[]` for public routes and webhooks.
- 400, 401, 429 and 500 responses are added to every operation they apply to, unless the route declares its own.
- Money fields are integer cents (`*Cents`).
- Webhooks are listed with their signature headers and are not called by API clients. Event streams (`/notifications/stream`, `/admin/logs/stream`) are `text/event-stream` with no item schema.

## Casing caveat

Responses are documented as the API returns them. Some resources return snake_case database rows, others camelCase, and some mix both. Pagination shapes also differ. The list of inconsistencies to settle before frontend wiring is in ADR 0012.
