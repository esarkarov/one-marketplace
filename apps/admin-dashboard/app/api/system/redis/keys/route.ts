import { NextRequest } from "next/server";
import { SESSION_COOKIE } from "../../../../../lib/admin-session";
import { getApiBaseUrl } from "../../../../../lib/admin-api";
import { proxyRedisKeys } from "../../../../../lib/handlers";

export async function GET(request: NextRequest) {
  return proxyRedisKeys(
    {
      baseUrl: getApiBaseUrl(),
      token: request.cookies.get(SESSION_COOKIE)?.value,
      signal: request.signal,
    },
    request.nextUrl.searchParams.get("pattern") ?? "*",
  );
}
