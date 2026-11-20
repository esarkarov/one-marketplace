import { clerkMiddleware } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

interface MeResponse {
  success: boolean;
  data?: {
    agencyExists: boolean;
    isOnboarded: boolean;
  };
}

const redirectToLandingPage = (request: NextRequest) =>
  NextResponse.redirect(
    new URL(
      process.env.NEXT_PUBLIC_LANDING_PAGE ?? "http://localhost:3000",
      request.url,
    ),
  );

export default clerkMiddleware(async (auth, request) => {
  if (request.nextUrl.pathname === "/api/me") {
    return NextResponse.next();
  }

  const { userId } = await auth();
  if (!userId) {
    return redirectToLandingPage(request);
  }

  try {
    const headers = new Headers();
    const cookie = request.headers.get("cookie");
    const authorization = request.headers.get("authorization");

    if (cookie) headers.set("cookie", cookie);
    if (authorization) headers.set("authorization", authorization);
    const meResponse = await fetch(new URL("/api/me", request.url), {
      headers,
      cache: "no-store",
    });

    if (!meResponse.ok) {
      return redirectToLandingPage(request);
    }

    const account = (await meResponse.json()) as MeResponse;
    if (!account.success || !account.data?.agencyExists) {
      return redirectToLandingPage(request);
    }

    const isEditingProfile = request.nextUrl.pathname === "/profile/edit";

    if (!account.data.isOnboarded) {
      if (isEditingProfile) {
        return NextResponse.next();
      }

      return NextResponse.redirect(new URL("/profile/edit", request.url));
    }

    return NextResponse.next();
  } catch (error) {
    console.error("Agency account status check failed.", error);
    return redirectToLandingPage(request);
  }
});

export const config = {
  matcher: [
    "/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)",
    "/(api|trpc)(.*)",
  ],
};
