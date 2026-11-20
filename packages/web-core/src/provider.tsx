import type { ApiClient, Role, Scope } from "@onemarketplace/api-client";
import { createApiClient, isApiError } from "@onemarketplace/api-client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  createContext,
  useContext,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { queryKeys } from "./query-keys";
import { stopSharedFor } from "./registries";

export interface ApiConfig {
  role: Role;
  scope: Scope | undefined;
  baseUrl: string;
}

export interface ApiProviderProps {
  baseUrl: string;
  role: Role;
  scope?: Scope;
  getToken: () => Promise<string | null>;
  children: ReactNode;
}

interface Internals {
  api: ApiClient;
  queryClient: QueryClient;
  getToken: () => Promise<string | null>;
}

const InternalsContext = createContext<Internals | null>(null);
const ConfigContext = createContext<ApiConfig | null>(null);

export const shouldRetry = (failureCount: number, error: unknown): boolean =>
  failureCount < 2 &&
  isApiError(error) &&
  (error.status === 0 || error.status >= 500);

export const createWebCoreQueryClient = (): QueryClient =>
  new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 30_000,
        refetchOnWindowFocus: false,
        retry: shouldRetry,
      },
      mutations: { retry: false },
    },
  });

export const ApiProvider = ({
  baseUrl,
  role,
  scope,
  getToken,
  children,
}: ApiProviderProps) => {
  const latest = useRef({ role, scope, getToken });
  useLayoutEffect(() => {
    latest.current = { role, scope, getToken };
  });

  const [internals] = useState<Internals>(() => {
    const stableGetToken = () => latest.current.getToken();
    return {
      queryClient: createWebCoreQueryClient(),
      getToken: stableGetToken,
      api: createApiClient({
        baseUrl,
        getToken: stableGetToken,
        getRole: () => latest.current.role,
        getScope: () => latest.current.scope,
      }),
    };
  });

  const config = useMemo<ApiConfig>(
    () => ({ role, scope, baseUrl }),
    [role, scope, baseUrl],
  );

  return (
    <QueryClientProvider client={internals.queryClient}>
      <InternalsContext.Provider value={internals}>
        <ConfigContext.Provider value={config}>
          {children}
        </ConfigContext.Provider>
      </InternalsContext.Provider>
    </QueryClientProvider>
  );
};

export const useInternals = (): Internals => {
  const value = useContext(InternalsContext);
  if (!value)
    throw new Error("web-core hooks must be used inside ApiProvider.");
  return value;
};

export const useApi = (): ApiClient => useInternals().api;

export const useApiConfig = (): ApiConfig => {
  const value = useContext(ConfigContext);
  if (!value)
    throw new Error("web-core hooks must be used inside ApiProvider.");
  return value;
};

/**
 * Call on sign-out: stops the shared notification stream and socket bound to
 * this client and drops every web-core query.
 */
export const resetWebCore = (queryClient: QueryClient): void => {
  stopSharedFor(queryClient);
  void queryClient.cancelQueries({ queryKey: queryKeys.root });
  queryClient.removeQueries({ queryKey: queryKeys.root });
};
