import type { Role, Scope } from "@onemarketplace/api-client";
import { useQueryClient, type QueryClient } from "@tanstack/react-query";
import { render } from "@testing-library/react";
import { vi } from "vitest";
import { ApiProvider } from "../provider";
import { FakeServer } from "./fake-server";

export const TOKEN = "clerk-session-token";

interface Options {
  role?: Role;
  scope?: Scope | undefined;
  getToken?: () => Promise<string | null>;
  server?: FakeServer;
}

export const captured: { queryClient: QueryClient | null } = {
  queryClient: null,
};

export const CaptureClient = () => {
  captured.queryClient = useQueryClient();
  return null;
};

export const mount = (ui: React.ReactNode, options: Options = {}) => {
  const server = options.server ?? new FakeServer();
  vi.stubGlobal("fetch", server.fetch);

  const tree = (props: Options) => (
    <ApiProvider
      baseUrl="http://api.test/api/v1"
      role={props.role ?? options.role ?? "client"}
      {...((props.scope ?? options.scope)
        ? { scope: (props.scope ?? options.scope) as Scope }
        : {})}
      getToken={props.getToken ?? options.getToken ?? (async () => TOKEN)}
    >
      <CaptureClient />
      {ui}
    </ApiProvider>
  );

  const result = render(tree({}));
  return {
    server,
    ...result,
    rerenderWith: (props: Options) => result.rerender(tree(props)),
  };
};
