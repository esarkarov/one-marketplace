# @onemarketplace/api-client

Typed client for the OneMarketplace API. Source only (exports point at `src/index.ts`), ESM, no React, Clerk, Next or `process.env`; the base URL and the token come from the caller.

## What it gives you

- `createApiClient({ baseUrl, getToken, getRole?, getScope?, fetch? })`: an [openapi-fetch](https://openapi-ts.dev/openapi-fetch/) client typed with the generated `paths`.
- `unwrap(promise)`: returns `data` from the `{ success, message, data }` envelope or throws `ApiError`.
- `ApiError { status, code, requestId, errors? }`, `isApiError`, `errorMessage` (a user-safe string).
- Formatters: `formatCents`, `dollarsToCents`, `centsToDollarsString`, `formatDate`, `formatDateTime`, `formatRelative`.
- Types: `Paths`, `Components`, `Role`, `Scope`.

## Usage

```ts
import { useAuth } from "@clerk/nextjs";
import {
  createApiClient,
  unwrap,
  errorMessage,
} from "@onemarketplace/api-client";

const { getToken } = useAuth();

const api = createApiClient({
  baseUrl: process.env.NEXT_PUBLIC_SERVER_URI!,
  getToken: () => getToken(),
  getRole: () => "client",
});

try {
  const page = await unwrap(api.GET("/api/v1/jobs", { params: { query: {} } }));
} catch (error) {
  showToast(errorMessage(error));
}
```

`baseUrl` is the API origin. A trailing `/api/v1` (as in `NEXT_PUBLIC_SERVER_URI`) is accepted and removed, because the spec paths already start with `/api/v1`.

## Behavior

- `Authorization: Bearer <token>` is sent whenever `getToken` returns a token. The token is never logged or stored. For admin operations pass the admin session token from `getToken`.
- `role` is added to the query of operations that declare it (`operationsWithRole`) when the caller did not pass one and `getRole` returns a value. `scope=agency` is added to the nine operations that declare `scope` (`operationsWithScope`) when `getScope` returns `agency`. Public operations get neither. The lookup is exact: openapi-fetch hands the middleware the spec path template, and the key is `METHOD path`.
- The generated types mark the `role` query parameter optional (the spec marks it required) because the client injects it. A request with no `getRole` and no explicit `role` is rejected by the API with 400.
- Role in the body is never touched. `POST /api/v1/auth/sign-up` declares `role` only in the JSON body, and 25 other operations declare it in both places (the API reads `body.role ?? query.role`). The caller sets the body field; the client only adds the query parameter.
- HTTP errors are returned by openapi-fetch as `{ error, response }`; `unwrap` turns them into `ApiError`. A non-JSON or empty error body becomes `code: "HTTP_ERROR"`. A failed `fetch` throws `ApiError` with status 0 and code `NETWORK_ERROR`. An `AbortError` is rethrown untouched.
- Money is integer cents. `dollarsToCents` parses a plain decimal string (`"12"`, `"12.5"`, `"12.50"`) without float math and rejects negatives, thousands separators, exponents, whitespace, `"12."`, `".5"`, more than two decimals and values above `Number.MAX_SAFE_INTEGER` cents.
- Date formatters default to `en-US` and the `UTC` time zone so output is deterministic; pass `timeZone` and `locale` to override. Null or invalid input gives `"—"`.

## Using it from a Next app

The package ships TypeScript source, so each app must add it to its dependencies (`"@onemarketplace/api-client": "workspace:*"`) and to `transpilePackages` in its Next config:

```ts
const nextConfig = { transpilePackages: ["@onemarketplace/api-client"] };
```

Apps do that in their own migration batches.

## Regenerating

`src/generated/schema.ts` and `src/generated/meta.ts` are generated from `docs/api/openapi.json` and committed. Each starts with a `DO NOT EDIT` header holding the sha256 of the OpenAPI document.

```sh
pnpm -C packages/api-client generate
```

Run it whenever the OpenAPI document changes; the test in `src/generated.test.ts` fails when the header hash no longer matches.

## Scripts

`typecheck`, `lint`, `test` and `generate`, each with `pnpm -C packages/api-client <script>`.
