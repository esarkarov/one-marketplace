import type { QueryClient } from "@tanstack/react-query";
import { ApiError } from "@onemarketplace/api-client";
import { renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { useApi, useApiConfig, shouldRetry } from "./provider";
import { queryKeys } from "./query-keys";
import { FakeServer, ok } from "./test/fake-server";
import { captured, mount } from "./test/render";

const seen: {
  clients: QueryClient[];
  apis: unknown[];
  configs: Array<{ role: string; scope: string | undefined }>;
} = { clients: [], apis: [], configs: [] };

let call!: () => Promise<unknown>;
const Probe = () => {
  const api = useApi();
  const config = useApiConfig();
  seen.apis.push(api);
  seen.configs.push({ role: config.role, scope: config.scope });
  call = () => api.GET("/api/v1/auth/status", { params: { query: {} } });
  return null;
};

describe("ApiProvider", () => {
  it("keeps one QueryClient and one api client across re-renders and prop changes", async () => {
    seen.apis.length = 0;
    seen.configs.length = 0;
    const server = new FakeServer();
    server.on("GET", "/api/v1/auth/status", () =>
      ok({
        role: "client",
        accountExists: true,
        accountId: null,
        isOnboarded: false,
      }),
    );
    const { rerenderWith } = mount(<Probe />, { server });
    const first = captured.queryClient;
    await call();

    rerenderWith({ role: "freelancer", scope: "agency" });
    rerenderWith({ role: "freelancer", scope: "agency" });

    expect(captured.queryClient).toBe(first);
    expect(new Set(seen.apis).size).toBe(1);
    expect(seen.configs[seen.configs.length - 1]).toEqual({
      role: "freelancer",
      scope: "agency",
    });

    await call();
    const roles = server.calls.map((c) => c.search.get("role"));
    expect(roles).toEqual(["client", "freelancer"]);
  });

  it("reads a rotated getToken without rebuilding the client", async () => {
    const server = new FakeServer();
    server.on("GET", "/api/v1/auth/status", () => ok({}));
    const { rerenderWith } = mount(<Probe />, {
      server,
      getToken: async () => "token-one",
    });
    await call();
    rerenderWith({ getToken: async () => "token-two" });
    await call();

    expect(server.calls.map((c) => c.headers.get("authorization"))).toEqual([
      "Bearer token-one",
      "Bearer token-two",
    ]);
  });

  it("applies the query defaults", () => {
    mount(<Probe />);
    const defaults = captured.queryClient!.getDefaultOptions();
    expect(defaults.queries?.staleTime).toBe(30_000);
    expect(defaults.queries?.refetchOnWindowFocus).toBe(false);
    expect(defaults.mutations?.retry).toBe(false);
  });

  it("throws outside the provider", () => {
    expect(() => renderHook(() => useApi())).toThrow(/ApiProvider/);
    expect(() => renderHook(() => useApiConfig())).toThrow(/ApiProvider/);
  });
});

describe("shouldRetry", () => {
  const apiError = (status: number) =>
    new ApiError({ status, code: "X", message: "m" });

  it("retries network errors and 5xx a limited number of times", () => {
    expect(shouldRetry(0, apiError(0))).toBe(true);
    expect(shouldRetry(0, apiError(500))).toBe(true);
    expect(shouldRetry(1, apiError(503))).toBe(true);
    expect(shouldRetry(2, apiError(503))).toBe(false);
  });

  it("never retries 4xx or unknown errors", () => {
    for (const status of [400, 401, 403, 404, 409, 422, 429]) {
      expect(shouldRetry(0, apiError(status))).toBe(false);
    }
    expect(shouldRetry(0, new Error("boom"))).toBe(false);
  });
});

describe("queryKeys", () => {
  it("includes role and scope in every key", () => {
    const keys = [
      queryKeys.auth("client"),
      queryKeys.notifications("client", "agency", {}),
      queryKeys.notificationsUnread("client", "agency"),
      queryKeys.conversations("client", "agency", {}),
      queryKeys.conversationMessages("client", "agency", "c1"),
    ];
    for (const key of keys) {
      expect(key.slice(0, 1)).toEqual(["web-core"]);
      expect(key).toContain("client");
    }
    expect(queryKeys.auth("client")).not.toEqual(queryKeys.auth("freelancer"));
    expect(queryKeys.conversations("client", undefined, {})).not.toEqual(
      queryKeys.conversations("client", "agency", {}),
    );
  });
});
