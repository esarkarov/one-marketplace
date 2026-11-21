"use client";

import { useAuth } from "@clerk/nextjs";
import { unwrap } from "@onemarketplace/api-client";
import {
  decideAccountGate,
  queryKeys,
  resetWebCore,
  useAccount,
  useApi,
  useApiConfig,
  useMessagingSocket,
  shouldPlayMessageSound,
  useNotificationStream,
} from "@onemarketplace/web-core";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { usePathname, useRouter } from "next/navigation";
import { useEffect } from "react";
import { messageSound } from "./hooks/message-sound";

const ONBOARDING_PATH = "/profile/edit";

const LANDING_PAGE =
  process.env.NEXT_PUBLIC_LANDING_PAGE ?? "http://localhost:3000";

export function SessionBoundary({ children }: { children: React.ReactNode }) {
  const { isLoaded, isSignedIn } = useAuth();
  const queryClient = useQueryClient();

  useEffect(() => {
    if (isLoaded && !isSignedIn) resetWebCore(queryClient);
  }, [isLoaded, isSignedIn, queryClient]);

  if (!isLoaded || !isSignedIn) return <>{children}</>;

  return (
    <AccountGate>
      <SessionEffects />
      {children}
    </AccountGate>
  );
}

function AccountGate({ children }: { children: React.ReactNode }) {
  const api = useApi();
  const { role, scope } = useApiConfig();
  const pathname = usePathname();
  const router = useRouter();

  const query = useQuery({
    queryKey: queryKeys.auth(role, scope),
    queryFn: () =>
      unwrap(api.GET("/api/v1/auth/status", { params: { query: {} } })),
  });

  const decision = decideAccountGate({
    status: query.status,
    auth: query.data,
    pathname,
    expectedRole: "client",
    onboardingPath: ONBOARDING_PATH,
  });

  const redirectTo = decision.action === "redirect" ? decision.to : null;
  const toLanding = decision.action === "redirect-landing";

  useEffect(() => {
    if (toLanding) window.location.assign(LANDING_PAGE);
    else if (redirectTo) router.replace(redirectTo);
  }, [toLanding, redirectTo, router]);

  if (decision.action !== "allow") {
    return (
      <div
        role="status"
        className="flex min-h-svh items-center justify-center bg-[#f4f6f2] text-sm text-[#72776f]"
      >
        Loading your account…
      </div>
    );
  }

  return <>{children}</>;
}

function SessionEffects() {
  const account = useAccount();

  useEffect(() => messageSound.install(), []);
  useNotificationStream();
  useMessagingSocket({
    onConversationUpdate: (payload) => {
      if (shouldPlayMessageSound(payload, account.isMine)) {
        messageSound.play();
      }
    },
  });

  return null;
}
