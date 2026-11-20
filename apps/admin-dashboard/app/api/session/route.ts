import { NextRequest, NextResponse } from "next/server";
import { SESSION_COOKIE } from "../../../lib/admin-session";
import { getApiBaseUrl } from "../../../lib/admin-api";
import { handleLogin, handleLogout } from "../../../lib/handlers";

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => null);
  const result = await handleLogin({
    body,
    baseUrl: getApiBaseUrl(),
    production: process.env.NODE_ENV === "production",
  });

  const response = NextResponse.json(result.body, { status: result.status });
  if (result.cookie) {
    response.cookies.set(
      result.cookie.name,
      result.cookie.value,
      result.cookie.options,
    );
  }
  return response;
}

export async function DELETE(request: NextRequest) {
  const result = handleLogout(request.headers);
  const response = NextResponse.json(result.body, { status: result.status });
  if (result.clearCookie) response.cookies.delete(SESSION_COOKIE);
  return response;
}
