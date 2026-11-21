import { clerkMiddleware } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

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

  return NextResponse.next();
});

export const config = {
  matcher: [
    "/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)",
    "/(api|trpc)(.*)",
  ],
};
