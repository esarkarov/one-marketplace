import type { Components, Role, Scope } from "@onemarketplace/api-client";
import type { QueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useRef, useState } from "react";
import { io as socketIo } from "socket.io-client";
import { useApiConfig, useInternals } from "./provider";
import { queryKeys } from "./query-keys";
import { trackShared } from "./registries";
import { createStore } from "./store";

export interface PresenceSnapshotPayload {
  userIds: string[];
}

export interface PresenceUpdatePayload {
  userId: string;
  online: boolean;
  lastActiveAt?: string;
}

export interface TypingUpdatePayload {
  conversationId: string;
  userId: string;
  isTyping: boolean;
}

export interface ConversationUpdatePayload {
  conversationId: string;
  messagesChanged: boolean;
  senderId: string | null;
}

export interface TypingSetPayload {
  conversationId: string;
  isTyping: boolean;
}

export interface ConversationReadPayload {
  conversationId: string;
  messageId: string;
}

export interface ServerToClientEvents {
  "presence:snapshot": (payload: PresenceSnapshotPayload) => void;
  "presence:update": (payload: PresenceUpdatePayload) => void;
  "typing:update": (payload: TypingUpdatePayload) => void;
  "conversation:update": (payload: ConversationUpdatePayload) => void;
}

export interface LifecycleEvents {
  connect: () => void;
  disconnect: (reason: string) => void;
  connect_error: (error: Error) => void;
}

export interface ClientToServerEvents {
  "typing:set": (payload: TypingSetPayload) => void;
  "conversation:read": (
    payload: ConversationReadPayload,
    acknowledge?: (result: { success: boolean }) => void,
  ) => void;
}

export interface MessagingSocket {
  on<E extends keyof (ServerToClientEvents & LifecycleEvents)>(
    event: E,
    handler: (ServerToClientEvents & LifecycleEvents)[E],
  ): unknown;
  emit<E extends keyof ClientToServerEvents>(
    event: E,
    ...args: Parameters<ClientToServerEvents[E]>
  ): unknown;
  disconnect(): unknown;
}

export interface SocketHandshakeAuth {
  token: string | null;
  role: Role;
  scope: Scope | "default";
}

export interface SocketOptions {
  auth: (callback: (data: SocketHandshakeAuth) => void) => void;
}

export type SocketFactory = (
  url: string,
  options: SocketOptions,
) => MessagingSocket;

const defaultFactory: SocketFactory = (url, options) =>
  socketIo(url, options) as unknown as MessagingSocket;

export interface CreateMessagingSocketOptions {
  baseUrl: string;
  role: Role;
  scope?: Scope | undefined;
  getToken: () => Promise<string | null>;
  io?: SocketFactory;
}

export const socketOrigin = (baseUrl: string): string =>
  new URL(baseUrl).origin;

/**
 * The handshake `auth` is a function, so socket.io calls it on every connect
 * and reconnect and each handshake carries a fresh token.
 */
export const createMessagingSocket = (
  options: CreateMessagingSocketOptions,
): MessagingSocket => {
  const factory = options.io ?? defaultFactory;
  return factory(socketOrigin(options.baseUrl), {
    auth: (callback) => {
      options
        .getToken()
        .catch(() => null)
        .then((token) =>
          callback({
            token,
            role: options.role,
            scope: options.scope ?? "default",
          }),
        );
    },
  });
};

export type SocketStatus = "connecting" | "open" | "closed" | "error";

interface SocketState {
  status: SocketStatus;
  presence: ReadonlySet<string>;
  typing: Readonly<Record<string, readonly string[]>>;
}

interface SharedSocket {
  refs: number;
  state: ReturnType<typeof createStore<SocketState>>;
  socket: MessagingSocket;
  listeners: Set<(payload: ConversationUpdatePayload) => void>;
  dispose: () => void;
}

const sockets = new Map<string, SharedSocket>();

export interface MessagingSocketHookOptions {
  onConversationUpdate?: (payload: ConversationUpdatePayload) => void;
  io?: SocketFactory;
}

interface AcquireSocketInput {
  baseUrl: string;
  role: Role;
  scope: Scope | undefined;
  queryClient: QueryClient;
  getToken: () => Promise<string | null>;
  io?: SocketFactory | undefined;
}

const withoutId = (list: readonly string[], id: string) =>
  list.filter((item) => item !== id);

export const acquireMessagingSocket = (input: AcquireSocketInput) => {
  const { baseUrl, role, scope, queryClient, getToken } = input;
  const key = `${socketOrigin(baseUrl)}|${role}|${scope ?? "default"}`;
  let entry = sockets.get(key);

  if (!entry) {
    const state = createStore<SocketState>({
      status: "connecting",
      presence: new Set(),
      typing: {},
    });
    const socket = createMessagingSocket({
      baseUrl,
      role,
      scope,
      getToken,
      ...(input.io ? { io: input.io } : {}),
    });
    const created: SharedSocket = {
      refs: 0,
      state,
      socket,
      listeners: new Set(),
      dispose: () => undefined,
    };
    const patch = (next: Partial<SocketState>) =>
      state.set({ ...state.get(), ...next });

    let connectedBefore = false;
    socket.on("connect", () => {
      patch({ status: "open" });
      if (connectedBefore) {
        void queryClient.invalidateQueries({
          queryKey: queryKeys.conversationsAll(role, scope),
        });
      }
      connectedBefore = true;
    });
    socket.on("disconnect", () =>
      patch({ status: "closed", presence: new Set(), typing: {} }),
    );
    socket.on("connect_error", () => patch({ status: "error" }));

    socket.on("presence:snapshot", ({ userIds }) =>
      patch({ presence: new Set(userIds) }),
    );
    socket.on("presence:update", ({ userId, online }) => {
      const presence = new Set(state.get().presence);
      if (online) presence.add(userId);
      else presence.delete(userId);
      patch({ presence });
    });
    socket.on("typing:update", ({ conversationId, userId, isTyping }) => {
      const current = state.get().typing[conversationId] ?? [];
      const rest = withoutId(current, userId);
      patch({
        typing: {
          ...state.get().typing,
          [conversationId]: isTyping ? [...rest, userId] : rest,
        },
      });
    });
    socket.on("conversation:update", (payload) => {
      void queryClient.invalidateQueries({
        queryKey: [...queryKeys.conversationsAll(role, scope), "list"],
      });
      if (payload.conversationId) {
        void queryClient.invalidateQueries({
          queryKey: queryKeys.conversationMessages(
            role,
            scope,
            payload.conversationId,
          ),
        });
      }
      created.listeners.forEach((listener) => listener(payload));
    });

    const untrack = trackShared(queryClient, () => created.dispose());
    created.dispose = () => {
      socket.disconnect();
      untrack();
      if (sockets.get(key) === created) sockets.delete(key);
    };
    sockets.set(key, created);
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

export const openMessagingSocketCount = (): number => sockets.size;

export interface MessagingSocketHook {
  status: SocketStatus;
  presence: ReadonlySet<string>;
  isOnline: (id: string | null | undefined) => boolean;
  typing: Readonly<Record<string, readonly string[]>>;
  typingIn: (conversationId: string) => readonly string[];
  setTyping: (conversationId: string, isTyping: boolean) => void;
}

const idleState: SocketState = {
  status: "connecting",
  presence: new Set(),
  typing: {},
};

export const useMessagingSocket = (
  options: MessagingSocketHookOptions = {},
): MessagingSocketHook => {
  const { baseUrl, role, scope } = useApiConfig();
  const { queryClient, getToken } = useInternals();
  const [state, setState] = useState<SocketState>(idleState);
  const socketRef = useRef<MessagingSocket | null>(null);
  const latest = useRef(options);
  useEffect(() => {
    latest.current = options;
  });

  useEffect(() => {
    const { entry, release } = acquireMessagingSocket({
      baseUrl,
      role,
      scope,
      queryClient,
      getToken,
      io: latest.current.io,
    });
    socketRef.current = entry.socket;
    const listener = (payload: ConversationUpdatePayload) =>
      latest.current.onConversationUpdate?.(payload);
    entry.listeners.add(listener);
    setState(entry.state.get());
    const unsubscribe = entry.state.subscribe(() =>
      setState(entry.state.get()),
    );
    return () => {
      unsubscribe();
      entry.listeners.delete(listener);
      socketRef.current = null;
      release();
    };
  }, [baseUrl, role, scope, queryClient, getToken]);

  const setTyping = useCallback((conversationId: string, isTyping: boolean) => {
    socketRef.current?.emit("typing:set", { conversationId, isTyping });
  }, []);

  return {
    status: state.status,
    presence: state.presence,
    isOnline: (id) => (id ? state.presence.has(id) : false),
    typing: state.typing,
    typingIn: (conversationId) => state.typing[conversationId] ?? [],
    setTyping,
  };
};

export type ConversationSummary =
  Components["schemas"]["MessagingConversation"];
