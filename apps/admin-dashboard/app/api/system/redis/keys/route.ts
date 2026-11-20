import { cookies } from "next/headers";
import { NextRequest, NextResponse } from "next/server";
import { SESSION_COOKIE } from "../../../../../lib/admin-session";

export async function GET(request: NextRequest) {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  const pattern = request.nextUrl.searchParams.get("pattern") ?? "*";
  const response = await fetch(
    `${process.env.NEXT_PUBLIC_SERVER_URI}/admin/system/redis/keys?pattern=${encodeURIComponent(pattern)}`,
    {
      cache: "no-store",
      headers: token ? { Authorization: `Bearer ${token}` } : undefined,
    },
  );
  const result = await response.json();
  return NextResponse.json(result, { status: response.status });
}
