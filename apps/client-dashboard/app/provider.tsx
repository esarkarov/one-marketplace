"use client";

import { useAuth } from "@clerk/nextjs";
import { ApiProvider } from "@onemarketplace/web-core";
import React from "react";
import { SessionBoundary } from "./session-boundary";

export const Provider = ({ children }: { children: React.ReactNode }) => {
  const { getToken } = useAuth();

  return (
    <ApiProvider
      baseUrl={process.env.NEXT_PUBLIC_SERVER_URI ?? ""}
      role="client"
      getToken={() => getToken()}
    >
      <SessionBoundary>{children}</SessionBoundary>
    </ApiProvider>
  );
};
