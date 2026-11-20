import { unwrap } from "@onemarketplace/api-client";
import type { Components, Role, Scope } from "@onemarketplace/api-client";
import {
  useMutation,
  useQuery,
  useQueryClient,
  type QueryClient,
} from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { useApi, useApiConfig, useInternals } from "./provider";
import { queryKeys, type PageParams } from "./query-keys";
import { trackShared } from "./registries";
import {
  createNotificationStream,
  type BackoffOptions,
  type SseEvent,
  type StreamStatus,
} from "./sse";
import { createStore } from "./store";

export type Notification = Components["schemas"]["NotificationsNotification"];

export interface NotificationsPage {
  results: Notification[];
  hasMore: boolean;
}

export interface UnreadSummary {
  count: number;
  capped: boolean;
}

export const UNREAD_SAMPLE_SIZE = 100;
export const DEFAULT_IDLE_THRESHOLD_MS = 3 * 60_000;
const SEEN_LIMIT = 500;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

export const parseNotificationPayload = (data: string): Notification | null => {
  let value: unknown;
  try {
    value = JSON.parse(data);
  } catch {
    return null;
  }
  if (!isRecord(value)) return null;
  const { id, eventId, type, title, message, isRead, createdAt } = value;
  if (
    typeof id !== "string" ||
    typeof eventId !== "string" ||
    typeof type !== "string" ||
    typeof title !== "string" ||
    typeof message !== "string" ||
    typeof isRead !== "boolean" ||
    !(createdAt === null || typeof createdAt === "string")
  ) {
    return null;
  }
  return {
    id,
    eventId,
    type,
    title,
    message,
    isRead,
    createdAt,
    recipientId:
      typeof value.recipientId === "string" ? value.recipientId : null,
    agencyId: typeof value.agencyId === "string" ? value.agencyId : null,
    link: typeof value.link === "string" ? value.link : null,
    metadata: isRecord(value.metadata) ? value.metadata : null,
    readAt: typeof value.readAt === "string" ? value.readAt : null,
  };
};

const listKeyPrefix = (role: Role, scope: Scope | undefined) =>
  [...queryKeys.notificationsAll(role, scope), "list"] as const;

const pageParamsOf = (queryKey: readonly unknown[]): PageParams => {
  const params = queryKey[5];
  return isRecord(params) ? (params as PageParams) : {};
};

const timeOf = (notification: Notification) =>
  notification.createdAt ? Date.parse(notification.createdAt) : Infinity;

const insertNewestFirst = (
  results: Notification[],
  notification: Notification,
): Notification[] => {
  const index = results.findIndex(
    (item) => timeOf(item) < timeOf(notification),
  );
  const next = [...results];
  next.splice(index === -1 ? next.length : index, 0, notification);
  return next;
};

/**
 * Merges one notification into the cached list queries by id. Returns true
 * when no cached list held it.
 */
export const mergeNotification = (
  queryClient: QueryClient,
  role: Role,
  scope: Scope | undefined,
  notification: Notification,
): boolean => {
  const caches = queryClient.getQueriesData<NotificationsPage>({
    queryKey: listKeyPrefix(role, scope),
  });
  const known = caches.some(([, page]) =>
    page?.results.some((item) => item.id === notification.id),
  );

  for (const [key, page] of caches) {
    if (!page) continue;
    if (page.results.some((item) => item.id === notification.id)) {
      queryClient.setQueryData<NotificationsPage>(key, {
        ...page,
        results: page.results.map((item) =>
          item.id === notification.id ? notification : item,
        ),
      });
      continue;
    }
    const { limit = 20, offset = 0 } = pageParamsOf(key);
    if (offset !== 0) continue;
    const results = insertNewestFirst(page.results, notification);
    const truncated = results.length > limit;
    queryClient.setQueryData<NotificationsPage>(key, {
      results: truncated ? results.slice(0, limit) : results,
      hasMore: page.hasMore || truncated,
    });
  }

  return !known;
};

const bumpUnread = (
  queryClient: QueryClient,
  role: Role,
  scope: Scope | undefined,
) =>
  queryClient.setQueryData<UnreadSummary>(
    queryKeys.notificationsUnread(role, scope),
    (current) => (current ? { ...current, count: current.count + 1 } : current),
  );

interface StreamState {
  status: StreamStatus;
  httpStatus?: number | undefined;
}

export interface NotificationStreamHookOptions {
  onNotification?: (notification: Notification) => void;
  idleThresholdMs?: number;
  fetch?: typeof fetch;
  backoff?: BackoffOptions;
}

interface SharedStream {
  key: string;
  refs: number;
  state: ReturnType<typeof createStore<StreamState>>;
  listeners: Set<(notification: Notification) => void>;
  dispose: () => void;
}

const streams = new Map<string, SharedStream>();

interface AcquireInput {
  baseUrl: string;
  role: Role;
  scope: Scope | undefined;
  queryClient: QueryClient;
  getToken: () => Promise<string | null>;
  options: NotificationStreamHookOptions;
}

export const acquireNotificationStream = (input: AcquireInput) => {
  const { baseUrl, role, scope, queryClient, getToken, options } = input;
  const key = `${baseUrl}|${role}|${scope ?? "default"}`;
  let entry = streams.get(key);

  if (!entry) {
    const created: SharedStream = {
      key,
      refs: 0,
      state: createStore<StreamState>({ status: "connecting" }),
      listeners: new Set(),
      dispose: () => undefined,
    };
    const seen = new Set<string>();
    const refetchAll = () => {
      const queryKey = queryKeys.notificationsAll(role, scope);
      void (async () => {
        await queryClient.cancelQueries({
          queryKey,
          predicate: (query) =>
            query.state.data === undefined &&
            query.state.fetchStatus === "fetching",
        });
        await queryClient.invalidateQueries({ queryKey });
      })();
    };

    const stream = createNotificationStream({
      baseUrl,
      role,
      scope,
      getToken,
      ...(options.fetch ? { fetch: options.fetch } : {}),
      ...(options.backoff ? { backoff: options.backoff } : {}),
      onStatus: (status, info) =>
        created.state.set({ status, httpStatus: info?.httpStatus }),
      onConnected: refetchAll,
      onEvent: (event: SseEvent) => {
        if (event.event !== "notification") return;
        const notification = parseNotificationPayload(event.data);
        if (!notification) return;
        const merged = mergeNotification(
          queryClient,
          role,
          scope,
          notification,
        );
        if (!merged || seen.has(notification.id)) return;
        seen.add(notification.id);
        if (!notification.isRead) bumpUnread(queryClient, role, scope);
        if (seen.size > SEEN_LIMIT) {
          const oldest = seen.values().next().value;
          if (oldest !== undefined) seen.delete(oldest);
        }
        created.listeners.forEach((listener) => listener(notification));
      },
    });

    const idleMs = options.idleThresholdMs ?? DEFAULT_IDLE_THRESHOLD_MS;
    let hiddenAt: number | null = null;
    const onVisibility = () => {
      if (document.visibilityState === "hidden") {
        hiddenAt ??= Date.now();
        return;
      }
      const away = hiddenAt === null ? 0 : Date.now() - hiddenAt;
      hiddenAt = null;
      if (away > idleMs) refetchAll();
    };
    document.addEventListener("visibilitychange", onVisibility);

    const untrack = trackShared(queryClient, () => {
      created.dispose();
    });
    created.dispose = () => {
      stream.stop();
      document.removeEventListener("visibilitychange", onVisibility);
      untrack();
      if (streams.get(key) === created) streams.delete(key);
    };

    streams.set(key, created);
    stream.start();
    entry = created;
  }

  const shared = entry;
  shared.refs += 1;
  let released = false;
  return {
    entry: shared,
    release: () => {
      if (released) return;
      released = true;
      shared.refs -= 1;
      if (shared.refs <= 0) shared.dispose();
    },
  };
};

export const openNotificationStreamCount = (): number => streams.size;

export interface NotificationStreamState {
  status: StreamStatus;
  httpStatus?: number | undefined;
}

/**
 * Opens (or joins) the single notification stream of this tab for the
 * provider's (baseUrl, role, scope). Safe to mount in several components.
 */
export const useNotificationStream = (
  options: NotificationStreamHookOptions = {},
): NotificationStreamState => {
  const { baseUrl, role, scope } = useApiConfig();
  const { queryClient, getToken } = useInternals();
  const [state, setState] = useState<StreamState>({ status: "connecting" });
  const latest = useRef(options);
  useEffect(() => {
    latest.current = options;
  });

  useEffect(() => {
    const { entry, release } = acquireNotificationStream({
      baseUrl,
      role,
      scope,
      queryClient,
      getToken,
      options: latest.current,
    });
    const listener = (notification: Notification) =>
      latest.current.onNotification?.(notification);
    entry.listeners.add(listener);
    setState(entry.state.get());
    const unsubscribe = entry.state.subscribe(() =>
      setState(entry.state.get()),
    );
    return () => {
      unsubscribe();
      entry.listeners.delete(listener);
      release();
    };
  }, [baseUrl, role, scope, queryClient, getToken]);

  return state;
};

export interface UseNotificationsOptions extends PageParams {
  enabled?: boolean;
}

export const useNotifications = (options: UseNotificationsOptions = {}) => {
  const api = useApi();
  const { role, scope } = useApiConfig();
  const { limit = 20, offset = 0, enabled = true } = options;

  return useQuery({
    queryKey: queryKeys.notifications(role, scope, { limit, offset }),
    queryFn: (): Promise<NotificationsPage> =>
      unwrap(
        api.GET("/api/v1/notifications", {
          params: { query: { limit, offset } },
        }),
      ),
    enabled,
  });
};

/**
 * The API has no unread-count endpoint, so the count is taken from the first
 * UNREAD_SAMPLE_SIZE notifications; `capped` is true when more exist.
 */
export const useUnreadNotificationCount = () => {
  const api = useApi();
  const { role, scope } = useApiConfig();

  const query = useQuery({
    queryKey: queryKeys.notificationsUnread(role, scope),
    queryFn: async (): Promise<UnreadSummary> => {
      const page = await unwrap(
        api.GET("/api/v1/notifications", {
          params: { query: { limit: UNREAD_SAMPLE_SIZE, offset: 0 } },
        }),
      );
      return {
        count: page.results.filter((item) => !item.isRead).length,
        capped: page.hasMore,
      };
    },
  });

  return {
    count: query.data?.count ?? 0,
    capped: query.data?.capped ?? false,
    status: query.status,
  };
};

type Snapshot = Array<[readonly unknown[], unknown]>;

const snapshotNotifications = (
  queryClient: QueryClient,
  role: Role,
  scope: Scope | undefined,
): Snapshot =>
  queryClient.getQueriesData({
    queryKey: queryKeys.notificationsAll(role, scope),
  });

const restore = (queryClient: QueryClient, snapshot: Snapshot | undefined) => {
  snapshot?.forEach(([key, data]) => queryClient.setQueryData(key, data));
};

export const useMarkNotificationRead = () => {
  const api = useApi();
  const queryClient = useQueryClient();
  const { role, scope } = useApiConfig();

  return useMutation({
    mutationFn: (notificationId: string) =>
      unwrap(
        api.PATCH("/api/v1/notifications/{notificationId}/read", {
          params: { path: { notificationId }, query: {} },
        }),
      ),
    onMutate: async (notificationId) => {
      const all = queryKeys.notificationsAll(role, scope);
      await queryClient.cancelQueries({ queryKey: all });
      const snapshot = snapshotNotifications(queryClient, role, scope);
      let wasUnread = false;

      for (const [key, page] of queryClient.getQueriesData<NotificationsPage>({
        queryKey: listKeyPrefix(role, scope),
      })) {
        if (!page) continue;
        queryClient.setQueryData<NotificationsPage>(key, {
          ...page,
          results: page.results.map((item) => {
            if (item.id !== notificationId) return item;
            if (!item.isRead) wasUnread = true;
            return { ...item, isRead: true, readAt: new Date().toISOString() };
          }),
        });
      }
      if (wasUnread) {
        queryClient.setQueryData<UnreadSummary>(
          queryKeys.notificationsUnread(role, scope),
          (current) =>
            current
              ? { ...current, count: Math.max(0, current.count - 1) }
              : current,
        );
      }
      return { snapshot };
    },
    onError: (_error, _id, context) => restore(queryClient, context?.snapshot),
    onSettled: () =>
      queryClient.invalidateQueries({
        queryKey: queryKeys.notificationsAll(role, scope),
      }),
  });
};

export const useMarkAllNotificationsRead = () => {
  const api = useApi();
  const queryClient = useQueryClient();
  const { role, scope } = useApiConfig();

  return useMutation({
    mutationFn: () =>
      unwrap(
        api.PATCH("/api/v1/notifications/read-all", { params: { query: {} } }),
      ),
    onMutate: async () => {
      await queryClient.cancelQueries({
        queryKey: queryKeys.notificationsAll(role, scope),
      });
      const snapshot = snapshotNotifications(queryClient, role, scope);
      const readAt = new Date().toISOString();

      for (const [key, page] of queryClient.getQueriesData<NotificationsPage>({
        queryKey: listKeyPrefix(role, scope),
      })) {
        if (!page) continue;
        queryClient.setQueryData<NotificationsPage>(key, {
          ...page,
          results: page.results.map((item) =>
            item.isRead ? item : { ...item, isRead: true, readAt },
          ),
        });
      }
      queryClient.setQueryData<UnreadSummary>(
        queryKeys.notificationsUnread(role, scope),
        (current) => (current ? { ...current, count: 0 } : current),
      );
      return { snapshot };
    },
    onError: (_error, _vars, context) =>
      restore(queryClient, context?.snapshot),
    onSettled: () =>
      queryClient.invalidateQueries({
        queryKey: queryKeys.notificationsAll(role, scope),
      }),
  });
};
