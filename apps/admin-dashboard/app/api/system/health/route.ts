import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { SESSION_COOKIE } from "../../../../lib/admin-session";

export async function GET() {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  const response = await fetch(
    `${process.env.NEXT_PUBLIC_SERVER_URI}/admin/system/health`,
    {
      cache: "no-store",
      headers: token ? { Authorization: `Bearer ${token}` } : undefined,
    },
  );
  const result = await response.json();
  return NextResponse.json(result, { status: response.status });
}
