import { createApiClient } from "@onemarketplace/api-client";

export interface AdminApiOptions {
  baseUrl: string;
  token: string | undefined;
  fetch?: typeof globalThis.fetch;
}

export function createAdminApi({
  baseUrl,
  token,
  fetch: fetchImpl,
}: AdminApiOptions) {
  return createApiClient({
    baseUrl,
    getToken: async () => token ?? null,
    ...(fetchImpl ? { fetch: fetchImpl } : {}),
  });
}

export type AdminApi = ReturnType<typeof createAdminApi>;

export function getApiBaseUrl(): string {
  const baseUrl = process.env.NEXT_PUBLIC_SERVER_URI;
  if (!baseUrl) throw new Error("NEXT_PUBLIC_SERVER_URI is not set.");
  return baseUrl;
}
