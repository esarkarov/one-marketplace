import { createClerkClient, verifyToken } from "@clerk/nextjs/server";
import { NextRequest, NextResponse } from "next/server";

const roles = ["client", "freelancer"] as const;

type SignupRole = (typeof roles)[number];

function redirectToError(request: NextRequest, reason: string) {
  const errorUrl = new URL("/error", request.url);
  errorUrl.searchParams.set("reason", reason);
  return NextResponse.redirect(errorUrl);
}

function isSignupRole(value: string | null): value is SignupRole {
  return roles.some((role) => role === value);
}

export async function GET(request: NextRequest) {
  const token = request.nextUrl.searchParams.get("token");
  const role = request.nextUrl.searchParams.get("role");
  const secretKey = process.env.CLERK_SECRET_KEY;

  if (!token || !role) {
    return redirectToError(request, "missing_signup_details");
  }

  if (!isSignupRole(role)) {
    return redirectToError(request, "invalid_role");
  }

  if (!secretKey) {
    console.error("CLERK_SECRET_KEY is not configured.");
    return redirectToError(request, "authentication_unavailable");
  }

  try {
    const claims = await verifyToken(token, {
      secretKey,
    });

    const clerk = createClerkClient({ secretKey });
    const user = await clerk.users.getUser(claims.sub);

    if (user.unsafeMetadata.role !== role) {
      return redirectToError(request, "role_mismatch");
    }
  } catch (error) {
    console.error("Clerk signup verification failed.", error);
    return redirectToError(request, "invalid_or_expired_token");
  }

  try {
    const backendResponse = await fetch(
      `${process.env.NEXT_PUBLIC_SERVER_URI}/auth/sign-up`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ role }),
        cache: "no-store",
      },
    );
    if (!backendResponse.ok) {
      const body = await backendResponse.text().catch(() => "<unreadable>");
      console.error(
        `Backend signup failed with status ${backendResponse.status}: ${body}`,
      );
      return redirectToError(request, "backend_signup_failed");
    }

    const result = await backendResponse.json();
    const isOnboarded = result?.data?.isOnboarded === true;

    const dashboardUrl =
      role === "client"
        ? process.env.NEXT_PUBLIC_CLIENT_DASHBOARD
        : process.env.NEXT_PUBLIC_FREELANCER_DASHBOARD;

    return NextResponse.redirect(
      new URL(isOnboarded ? "/" : "/profile/edit", dashboardUrl),
      303,
    );
  } catch (error) {
    console.error("Backend signup forwarding failed.", error);
    return redirectToError(request, "backend_signup_failed");
  }
}
