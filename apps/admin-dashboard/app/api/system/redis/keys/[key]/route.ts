import { NextRequest } from "next/server";
import { SESSION_COOKIE } from "../../../../../../lib/admin-session";
import { getApiBaseUrl } from "../../../../../../lib/admin-api";
import { proxyRedisKey } from "../../../../../../lib/handlers";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ key: string }> },
) {
  const { key } = await params;
  return proxyRedisKey(
    {
      baseUrl: getApiBaseUrl(),
      token: request.cookies.get(SESSION_COOKIE)?.value,
      signal: request.signal,
    },
    key,
  );
}
