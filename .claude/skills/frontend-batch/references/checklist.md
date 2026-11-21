# Frontend sub-batch checklist

- No hand-written fetch to the API, no `any` on API data, no second notification stream or socket (web-core owns one per tab).
- Money: send and read `*Cents` integers; display with `formatCents`; never `/ 100` or `toFixed` on money in components.
- Lists: `data.results`, `hasMore` or `nextCursor`; messages use a cursor (default 30, max 50).
- Fields lowerCamelCase; enums UPPER_SNAKE; contract status includes `CANCELLED`.
- Errors: branch on `code`, show `message`, log `requestId`; 401 handling follows web-core.
- Role and scope: every operation that needs `role` or `scope` gets it from the provider or the call.
- Ids: public ids only; own-message checks use `useAccount().isMine(id)`, not the Clerk user id.
- No secrets or tokens in query strings; redirects use `safeNextPath`-style same-origin checks.
- Token for socket and SSE is fetched fresh on every connect.
- Next.js: read `node_modules/next/dist/docs/` for the API you use before writing it; keep `turbopack.root` unset.
- UI uses design-system tokens; no new dependencies without the catalog.
