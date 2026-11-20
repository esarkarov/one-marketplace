# @onemarketplace/web-core

Shared React layer on top of `@onemarketplace/api-client`: one provider, the account, the notification stream, the messaging socket, unread counts and the message sound. Source only (exports point at `src/index.ts`), ESM. No Clerk, Next or `process.env`: the app passes `baseUrl` and `getToken`.

Peer dependencies: `react`, `react-dom`, `@tanstack/react-query`, `socket.io-client`.

## Public API

- `ApiProvider({ baseUrl, role, scope?, getToken, children })`, `useApi()`, `useApiConfig()`, `resetWebCore(queryClient)`.
- `queryKeys`: the key factory every hook uses.
- `useAccount()`: `{ status, accountId, agencyId, role, scope, actorId, presenceId, isMine, refetch }`.
- `useNotificationStream({ onNotification?, idleThresholdMs? })`, `useNotifications({ limit?, offset? })`, `useUnreadNotificationCount()`, `useMarkNotificationRead()`, `useMarkAllNotificationsRead()`.
- `parseSseChunks`, `createNotificationStream` (the framework-free pieces).
- `useMessagingSocket({ onConversationUpdate? })`, `createMessagingSocket`.
- `useConversations({ limit?, offset? })`, `useUnreadMessages()`.
- `createSoundPlayer(url)`.

## Usage

```tsx
"use client";

import { useAuth } from "@clerk/nextjs";
import {
  ApiProvider,
  createSoundPlayer,
  resetWebCore,
  useAccount,
  useMessagingSocket,
  useNotificationStream,
  useUnreadMessages,
  useUnreadNotificationCount,
} from "@onemarketplace/web-core";
import { useEffect, useMemo } from "react";

export function Providers({ children }: { children: React.ReactNode }) {
  const { getToken } = useAuth();

  return (
    <ApiProvider
      baseUrl={process.env.NEXT_PUBLIC_SERVER_URI!}
      role="client"
      getToken={() => getToken()}
    >
      <SessionEffects />
      {children}
    </ApiProvider>
  );
}

function SessionEffects() {
  const sound = useMemo(() => createSoundPlayer("/notification.mp3"), []);
  const account = useAccount();

  useEffect(() => sound.install(), [sound]);
  useNotificationStream({ onNotification: () => sound.play() });
  useMessagingSocket({
    onConversationUpdate: ({ senderId }) => {
      if (!account.isMine(senderId)) sound.play();
    },
  });

  return null;
}

function Badges() {
  const notifications = useUnreadNotificationCount();
  const messages = useUnreadMessages();
  return (
    <>
      {notifications.count}
      {notifications.capped ? "+" : ""} / {messages.count}
    </>
  );
}
```

`getToken` is read through a ref, so a new function identity or a rotated token never recreates the client. `baseUrl` may carry a trailing `/api/v1`.

### Sign-out

`ApiProvider` owns one `QueryClient` for its lifetime. Before the user is signed out (or when Clerk reports no session), call `resetWebCore(queryClient)` with the client from `useQueryClient()`. It stops the shared notification stream and socket bound to that client, cancels and removes every web-core query (account, notifications, conversations) and leaves the rest of your cache alone.

```tsx
const queryClient = useQueryClient();
const { isSignedIn } = useAuth();
useEffect(() => {
  if (isSignedIn === false) resetWebCore(queryClient);
}, [isSignedIn, queryClient]);
```

### Next apps

The package ships TypeScript source, so add it to the app's dependencies (`"@onemarketplace/web-core": "workspace:*"`) and to `transpilePackages`, next to `@onemarketplace/api-client`:

```ts
const nextConfig = {
  transpilePackages: ["@onemarketplace/api-client", "@onemarketplace/web-core"],
};
```

Apps do this in their own migration batches.

## Query key convention

Every key is `["web-core", <domain>, role, scope, ...rest]`, where `scope` is `"agency"` or `"default"`. Role and scope are always in the key, so switching audience never reads another audience's cache. `notificationsAll(role, scope)` and `conversationsAll(role, scope)` are prefixes for invalidating a whole domain; `notifications(...)`, `notificationsUnread(...)`, `conversations(...)` and `conversationMessages(...)` are the leaves. Use `queryKeys` for any invalidation you write yourself.

## Verified facts the code encodes

### Account and ids (`useAccount`)

- `GET /api/v1/auth/status` returns `{ role, accountExists, accountId, isOnboarded }`. `accountId` is the public `accounts.id` (null before sign-up). There is no agency id in that response.
- In agency scope the agency id comes from `GET /api/v1/agency/membership` (`{ agencyId }`, null for a non-member). It is only requested in agency scope.
- `role` is injected by the api client on both calls; `scope` is not a parameter of either.

**The actorId rule.** The API stores a message sender per account, never per agency, and `typing:update` also carries the member's account id:

| Where the id shows up                                              | Id used                                 | Field on `useAccount()`   |
| ------------------------------------------------------------------ | --------------------------------------- | ------------------------- |
| `senderId` of a message, `conversation:update.senderId`, typing id | public account id, in every scope       | `actorId` (and `isMine`)  |
| `presence:snapshot` and `presence:update` ids                      | agency id in agency scope, else account | `presenceId` (`agencyId`) |

`isMine(senderId)` compares with `actorId` only. In an agency conversation a teammate's message therefore reports `false`: the API does not say that two accounts are the same agency on a message. Clerk user ids are never exposed or compared; the API does not return them.

### Notifications

- Stream: `GET /api/v1/notifications/stream?role=<role>[&scope=agency]` (SSE, `Authorization: Bearer`). The server sends `event: connected` with `data: {}`, `event: notification` with the JSON notification, and `: heartbeat` comments every 25 s. There is no replay.
- Notification payload (also the list item): `id`, `eventId`, `recipientId`, `agencyId`, `type`, `title`, `message`, `link`, `metadata`, `isRead`, `readAt`, `createdAt`.
- List: `GET /api/v1/notifications?limit&offset` (default 20, max 100) answers `{ results, hasMore }`. There is no unread-count endpoint, so `useUnreadNotificationCount` counts unread items in the first 100 and sets `capped` when `hasMore` is true.
- Mutations: `PATCH /notifications/{id}/read` and `PATCH /notifications/read-all`, optimistic with rollback.

### Messaging

- Socket handshake `auth`: `{ token, role, scope }` (`scope` is `"agency"` or `"default"`). The origin is `new URL(baseUrl).origin`.
- Server events: `presence:snapshot { userIds }`, `presence:update { userId, online, lastActiveAt? }`, `typing:update { conversationId, userId, isTyping }`, `conversation:update { conversationId, messagesChanged, senderId }`. Client events: `typing:set { conversationId, isTyping }` and `conversation:read { conversationId, messageId }` with an acknowledgement.
- Inbox: `GET /api/v1/conversations?limit&offset` answers `{ results, hasMore, totalUnread }`; `useUnreadMessages` reads `totalUnread` from the same query as `useConversations()` with default parameters, so a header badge and the inbox do not double-fetch. Messages use a cursor (`{ results, nextCursor }`); `queryKeys.conversationMessages` exists for the app's own message query and is invalidated by `conversation:update`.

## Behavior

### Notification stream

- `fetch` based (EventSource cannot send `Authorization`). A fresh token is read on every connect attempt; a null token stops with status `error` and `httpStatus: 401`. Tokens are never logged.
- Reconnects after errors and after a clean end of stream. Backoff doubles from 1 s to 30 s with jitter (50% to 100% of the delay) and resets once a connection stayed open at least 10 s. Attempts never overlap.
- 401 and 403 stop permanently (status `error`, `httpStatus` set); the app decides what to do. `stop()` aborts the in-flight read.
- On every successful connect the hook cancels initial loads still in flight and invalidates every notification query, so the lists refetch (the API has no replay). The same refetch runs when the tab becomes visible after being hidden for more than 3 minutes (`idleThresholdMs` overrides it).
- `parseSseChunks(chunk, remainder)` is the incremental parser: it handles frames split anywhere, CRLF, LF and CR, multi-line `data:`, `event:`, `id:` and comment lines, and returns `{ events, remainder }`. A frame with empty data is not dispatched.

### One connection per tab

The notification stream and the socket live in module-level, ref-counted registries keyed by `baseUrl|role|scope` (the socket by origin). Mounting the hook in a header and a page opens one connection; it closes when the last subscriber unmounts and a later mount opens a new one. New notifications are merged by `id` into every cached list at offset 0 (newest first, no duplicates), the unread count is bumped, and `onNotification` fires once per newly merged id (never for a duplicate or an id already in a cached list). The registry entry uses the `QueryClient` of the first subscriber.

### Messaging socket

- The handshake `auth` is a function, so every connect and reconnect sends a fresh token.
- Reconnects (not the first connect) invalidate every conversations query. `conversation:update` invalidates the conversations lists and, when `conversationId` is present, that conversation's messages query, then calls `onConversationUpdate`.
- `useMessagingSocket()` returns `{ status, presence, isOnline, typing, typingIn, setTyping }`. Presence and typing are cleared on disconnect.

### Provider defaults

`staleTime` 30 s, no refetch on window focus, queries retry up to twice and only for network errors (status 0) and 5xx, never 4xx; mutations do not retry.

## Scripts

`typecheck`, `lint`, `test` and `test:quiet`, each with `pnpm -C packages/web-core <script>`. Tests run in vitest with jsdom, a fake fetch with `ReadableStream` bodies and a fake socket factory; nothing touches the network.
