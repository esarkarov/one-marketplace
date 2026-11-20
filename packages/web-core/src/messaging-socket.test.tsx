import { act, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { useConversations, useUnreadMessages } from "./conversations";
import {
  createMessagingSocket,
  openMessagingSocketCount,
  useMessagingSocket,
  type ConversationUpdatePayload,
  type MessagingSocket,
  type MessagingSocketHook,
  type SocketHandshakeAuth,
  type SocketOptions,
} from "./messaging-socket";
import { queryKeys } from "./query-keys";
import { FakeServer, ok } from "./test/fake-server";
import { captured, mount } from "./test/render";

type Handler = (...args: never[]) => void;

class FakeSocket {
  handlers = new Map<string, Handler[]>();
  emitted: Array<[string, unknown]> = [];
  disconnected = false;

  on(event: string, handler: Handler) {
    this.handlers.set(event, [...(this.handlers.get(event) ?? []), handler]);
    return this;
  }
  emit(event: string, payload: unknown) {
    this.emitted.push([event, payload]);
    return this;
  }
  disconnect() {
    this.disconnected = true;
    return this;
  }
  fire(event: string, payload?: unknown) {
    (this.handlers.get(event) ?? []).forEach((h) =>
      (h as (p?: unknown) => void)(payload),
    );
  }
}

const factory = () => {
  const sockets: FakeSocket[] = [];
  const urls: string[] = [];
  const optionsSeen: SocketOptions[] = [];
  const io = vi.fn((url: string, options: SocketOptions) => {
    const socket = new FakeSocket();
    sockets.push(socket);
    urls.push(url);
    optionsSeen.push(options);
    return socket as unknown as MessagingSocket;
  });
  return { io, sockets, urls, optionsSeen };
};

const conversationsServer = (totalUnread = 3) => {
  const server = new FakeServer();
  server.on("GET", "/api/v1/conversations", () =>
    ok({ results: [], hasMore: false, totalUnread }),
  );
  return server;
};

describe("createMessagingSocket", () => {
  it("connects to the origin of baseUrl without the api path", () => {
    const f = factory();
    createMessagingSocket({
      baseUrl: "http://api.test:4000/api/v1",
      role: "client",
      getToken: async () => "t",
      io: f.io,
    });
    expect(f.urls).toEqual(["http://api.test:4000"]);
  });

  it("builds the handshake auth with a fresh token on every call", async () => {
    const f = factory();
    let rotation = 0;
    createMessagingSocket({
      baseUrl: "http://api.test/api/v1",
      role: "freelancer",
      scope: "agency",
      getToken: async () => `token-${++rotation}`,
      io: f.io,
    });
    const auth = f.optionsSeen[0]!.auth;
    expect(typeof auth).toBe("function");

    const handshakes: SocketHandshakeAuth[] = [];
    auth((data) => handshakes.push(data));
    auth((data) => handshakes.push(data));
    await waitFor(() => expect(handshakes).toHaveLength(2));

    expect(handshakes).toEqual([
      { token: "token-1", role: "freelancer", scope: "agency" },
      { token: "token-2", role: "freelancer", scope: "agency" },
    ]);
  });

  it("sends the default scope and a null token when the token call fails", async () => {
    const f = factory();
    createMessagingSocket({
      baseUrl: "http://api.test",
      role: "client",
      getToken: async () => {
        throw new Error("no session");
      },
      io: f.io,
    });
    const handshakes: SocketHandshakeAuth[] = [];
    f.optionsSeen[0]!.auth((data) => handshakes.push(data));
    await waitFor(() => expect(handshakes).toHaveLength(1));
    expect(handshakes[0]).toEqual({
      token: null,
      role: "client",
      scope: "default",
    });
  });
});

let hook: MessagingSocketHook;
let updates: ConversationUpdatePayload[];

const Probe = ({ io }: { io: ReturnType<typeof factory>["io"] }) => {
  hook = useMessagingSocket({
    io,
    onConversationUpdate: (payload) => updates.push(payload),
  });
  return null;
};

describe("useMessagingSocket", () => {
  it("shares one socket per tab and disconnects after the last unmount", () => {
    const f = factory();
    updates = [];
    const { unmount } = mount(
      <>
        <Probe io={f.io} />
        <Probe io={f.io} />
      </>,
      { server: conversationsServer() },
    );
    expect(f.io).toHaveBeenCalledTimes(1);
    expect(openMessagingSocketCount()).toBe(1);

    unmount();
    expect(f.sockets[0]?.disconnected).toBe(true);
    expect(openMessagingSocketCount()).toBe(0);
  });

  it("tracks presence, typing and status from the server events", () => {
    const f = factory();
    updates = [];
    mount(<Probe io={f.io} />, { server: conversationsServer() });
    const socket = f.sockets[0]!;

    act(() => socket.fire("connect"));
    expect(hook.status).toBe("open");

    act(() => socket.fire("presence:snapshot", { userIds: ["a", "b"] }));
    expect([...hook.presence].sort()).toEqual(["a", "b"]);
    expect(hook.isOnline("a")).toBe(true);

    act(() => socket.fire("presence:update", { userId: "c", online: true }));
    act(() =>
      socket.fire("presence:update", {
        userId: "a",
        online: false,
        lastActiveAt: "2026-11-20T10:00:00.000Z",
      }),
    );
    expect([...hook.presence].sort()).toEqual(["b", "c"]);

    act(() =>
      socket.fire("typing:update", {
        conversationId: "conv-1",
        userId: "b",
        isTyping: true,
      }),
    );
    expect(hook.typingIn("conv-1")).toEqual(["b"]);
    act(() =>
      socket.fire("typing:update", {
        conversationId: "conv-1",
        userId: "b",
        isTyping: false,
      }),
    );
    expect(hook.typingIn("conv-1")).toEqual([]);

    act(() => socket.fire("disconnect", "transport close"));
    expect(hook.status).toBe("closed");
    expect(hook.presence.size).toBe(0);

    act(() => socket.fire("connect_error", new Error("nope")));
    expect(hook.status).toBe("error");
  });

  it("emits typing:set with the conversation id", () => {
    const f = factory();
    updates = [];
    mount(<Probe io={f.io} />, { server: conversationsServer() });

    act(() => hook.setTyping("conv-9", true));
    expect(f.sockets[0]?.emitted).toEqual([
      ["typing:set", { conversationId: "conv-9", isTyping: true }],
    ]);
  });

  it("invalidates the conversations on reconnect but not on the first connect", async () => {
    const f = factory();
    updates = [];
    const server = conversationsServer();
    const Inbox = () => {
      useConversations();
      return null;
    };
    mount(
      <>
        <Probe io={f.io} />
        <Inbox />
      </>,
      { server },
    );
    await waitFor(() =>
      expect(server.count("GET", "/api/v1/conversations")).toBe(1),
    );
    const socket = f.sockets[0]!;

    act(() => socket.fire("connect"));
    await new Promise((r) => setTimeout(r, 20));
    expect(server.count("GET", "/api/v1/conversations")).toBe(1);

    act(() => socket.fire("disconnect", "transport close"));
    act(() => socket.fire("connect"));
    await waitFor(() =>
      expect(server.count("GET", "/api/v1/conversations")).toBe(2),
    );
  });

  it("invalidates the list and that conversation's messages on conversation:update", async () => {
    const f = factory();
    updates = [];
    const server = conversationsServer();
    const Inbox = () => {
      useConversations();
      return null;
    };
    mount(
      <>
        <Probe io={f.io} />
        <Inbox />
      </>,
      { server },
    );
    await waitFor(() =>
      expect(server.count("GET", "/api/v1/conversations")).toBe(1),
    );
    const client = captured.queryClient!;
    const messagesKey = queryKeys.conversationMessages(
      "client",
      undefined,
      "conv-1",
    );
    const otherKey = queryKeys.conversationMessages(
      "client",
      undefined,
      "conv-2",
    );
    client.setQueryData(messagesKey, { results: [] });
    client.setQueryData(otherKey, { results: [] });

    const payload = {
      conversationId: "conv-1",
      messagesChanged: true,
      senderId: "x",
    };
    act(() => f.sockets[0]!.fire("conversation:update", payload));

    await waitFor(() =>
      expect(server.count("GET", "/api/v1/conversations")).toBe(2),
    );
    expect(client.getQueryState(messagesKey)?.isInvalidated).toBe(true);
    expect(client.getQueryState(otherKey)?.isInvalidated).toBe(false);
    expect(updates).toEqual([payload]);
  });
});

describe("useUnreadMessages", () => {
  it("reads totalUnread from the inbox query without a second request", async () => {
    const server = conversationsServer(7);
    let count = -1;
    const Both = () => {
      useConversations();
      count = useUnreadMessages().count;
      return null;
    };
    mount(
      <>
        <Both />
        <Both />
      </>,
      { server },
    );
    await waitFor(() => expect(count).toBe(7));
    expect(server.count("GET", "/api/v1/conversations")).toBe(1);
  });
});
