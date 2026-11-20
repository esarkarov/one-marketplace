import { NextRequest, NextResponse } from "next/server";
import { createSessionToken, SESSION_COOKIE } from "../../../lib/admin-session";

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => null);
  const password = typeof body?.password === "string" ? body.password : "";

  const backendResponse = await fetch(
    `${process.env.NEXT_PUBLIC_SERVER_URI}/admin/auth/login`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password }),
    },
  ).catch(() => null);

  if (!backendResponse) {
    return NextResponse.json(
      { success: false, message: "Could not reach the server." },
      { status: 502 },
    );
  }

  const result = await backendResponse
    .json()
    .catch(() => ({ message: "Login failed." }));
  if (!backendResponse.ok) {
    return NextResponse.json(
      { success: false, message: result.message ?? "Incorrect password." },
      { status: backendResponse.status },
    );
  }

  const secret = process.env.ADMIN_SESSION_SECRET;
  if (!secret) {
    return NextResponse.json(
      { success: false, message: "Admin session is not configured." },
      { status: 503 },
    );
  }

  const { token, maxAgeSeconds } = await createSessionToken(secret);
  const response = NextResponse.json({ success: true });
  response.cookies.set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: maxAgeSeconds,
    path: "/",
  });
  return response;
}

export async function DELETE() {
  const response = NextResponse.json({ success: true });
  response.cookies.delete(SESSION_COOKIE);
  return response;
}
