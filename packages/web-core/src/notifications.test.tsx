import { act, waitFor } from "@testing-library/react";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import {
  openNotificationStreamCount,
  parseNotificationPayload,
  useMarkAllNotificationsRead,
  useMarkNotificationRead,
  useNotificationStream,
  useNotifications,
  useUnreadNotificationCount,
  type Notification,
  type NotificationsPage,
} from "./notifications";
import { resetWebCore } from "./provider";
import { queryKeys } from "./query-keys";
import {
  FakeServer,
  failure,
  flush,
  frame,
  makeNotification,
  ok,
} from "./test/fake-server";
import { captured, mount } from "./test/render";

const FAST = { initialMs: 1, maxMs: 1, random: () => 0 };

const seedServer = (initial: Notification[]) => {
  const server = new FakeServer();
  let list = initial;
  server.on("GET", "/api/v1/notifications", () =>
    ok({ results: list, hasMore: false }),
  );
  return {
    server,
    setList: (next: Notification[]) => {
      list = next;
    },
  };
};

const Stream = ({
  onNotification,
  idleThresholdMs,
}: {
  onNotification?: (n: Notification) => void;
  idleThresholdMs?: number;
}) => {
  useNotificationStream({
    ...(onNotification ? { onNotification } : {}),
    ...(idleThresholdMs === undefined ? {} : { idleThresholdMs }),
    backoff: FAST,
  });
  return null;
};

const Gate = ({ idleThresholdMs }: { idleThresholdMs?: number }) => {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button onClick={() => setOpen(true)}>open-stream</button>
      {open ? (
        <Stream
          {...(idleThresholdMs === undefined ? {} : { idleThresholdMs })}
        />
      ) : null}
    </>
  );
};

const List = () => {
  const query = useNotifications();
  return (
    <ul>
      {(query.data?.results ?? []).map((n) => (
        <li key={n.id} data-read={String(n.isRead)}>
          {n.id}
        </li>
      ))}
    </ul>
  );
};

const Unread = () => {
  const { count } = useUnreadNotificationCount();
  return <p data-testid="unread">{count}</p>;
};

const settleConnectRefetch = async (server: FakeServer) => {
  await waitFor(() =>
    expect(server.count("GET", "/api/v1/notifications")).toBeGreaterThanOrEqual(
      2,
    ),
  );
  await waitFor(() => expect(captured.queryClient?.isFetching()).toBe(0));
  await flush();
};

const ids = (container: HTMLElement) =>
  [...container.querySelectorAll("li")].map((li) => li.textContent);

describe("parseNotificationPayload", () => {
  it("accepts the camelCase payload of the API", () => {
    const n = makeNotification("a", {
      agencyId: "00000000-0000-4000-8000-0000000000aa",
      metadata: { milestoneId: "m1" },
    });
    expect(parseNotificationPayload(JSON.stringify(n))).toEqual(n);
  });

  it("rejects malformed or snake_case payloads", () => {
    expect(parseNotificationPayload("not json")).toBeNull();
    expect(parseNotificationPayload("[]")).toBeNull();
    expect(
      parseNotificationPayload(JSON.stringify({ id: "a", is_read: false })),
    ).toBeNull();
  });
});

describe("useNotificationStream", () => {
  it("shares one stream between components and stops after the last unmount", async () => {
    const { server } = seedServer([]);
    const { unmount, rerenderWith } = mount(
      <>
        <Stream />
        <Stream />
      </>,
      { server },
    );
    await waitFor(() => expect(server.streams).toHaveLength(1));
    await flush();

    expect(server.count("GET", "/api/v1/notifications/stream")).toBe(1);
    expect(openNotificationStreamCount()).toBe(1);
    expect(server.calls[0]?.search.get("role")).toBe("client");
    expect(server.calls[0]?.headers.get("authorization")).toBe(
      "Bearer clerk-session-token",
    );
    rerenderWith({});
    expect(server.streams[0]?.signal?.aborted).toBe(false);

    unmount();
    expect(server.streams[0]?.signal?.aborted).toBe(true);
    expect(openNotificationStreamCount()).toBe(0);

    mount(<Stream />, { server });
    await waitFor(() => expect(server.streams).toHaveLength(2));
    expect(server.count("GET", "/api/v1/notifications/stream")).toBe(2);
  });

  it("merges a new notification by id without duplicates and notifies once", async () => {
    const existing = makeNotification("old", {
      createdAt: "2026-11-20T09:00:00.000Z",
    });
    const { server, setList } = seedServer([existing]);
    const seen: string[] = [];
    const { container } = mount(
      <>
        <Stream onNotification={(n) => seen.push(n.id)} />
        <List />
      </>,
      { server },
    );
    await waitFor(() => expect(ids(container)).toEqual(["old"]));
    await waitFor(() => expect(server.streams).toHaveLength(1));
    await settleConnectRefetch(server);
    const stream = server.streams[0]!;

    const fresh = makeNotification("new", {
      createdAt: "2026-11-20T11:00:00.000Z",
    });
    setList([fresh, existing]);
    await act(async () => {
      stream.push(frame(fresh));
      await flush();
    });
    await waitFor(() => expect(ids(container)).toEqual(["new", "old"]));
    expect(seen).toEqual(["new"]);

    await act(async () => {
      stream.push(frame(fresh));
      stream.push(frame(existing));
      await flush();
      await flush();
    });
    expect(ids(container)).toEqual(["new", "old"]);
    expect(seen).toEqual(["new"]);
  });

  it("ignores events that are not notifications or are malformed", async () => {
    const { server } = seedServer([]);
    const seen: string[] = [];
    mount(<Stream onNotification={(n) => seen.push(n.id)} />, { server });
    await waitFor(() => expect(server.streams).toHaveLength(1));
    await act(async () => {
      server.streams[0]!.push("event: connected\ndata: {}\n\n");
      server.streams[0]!.push("event: notification\ndata: {oops\n\n");
      await flush();
    });
    expect(seen).toEqual([]);
  });

  it("bumps the unread count once per new unread notification", async () => {
    const { server, setList } = seedServer([makeNotification("old")]);
    setList([makeNotification("old")]);
    const { getByTestId } = mount(
      <>
        <Stream />
        <Unread />
      </>,
      { server },
    );
    await waitFor(() => expect(getByTestId("unread").textContent).toBe("1"));
    await waitFor(() => expect(server.streams).toHaveLength(1));
    await settleConnectRefetch(server);
    const unreadFetches = server.count("GET", "/api/v1/notifications");

    await act(async () => {
      server.streams[0]!.push(frame(makeNotification("n1")));
      server.streams[0]!.push(frame(makeNotification("n1")));
      await flush();
    });
    await waitFor(() => expect(getByTestId("unread").textContent).toBe("2"));
    await flush();
    expect(getByTestId("unread").textContent).toBe("2");
    expect(server.count("GET", "/api/v1/notifications")).toBe(unreadFetches);
  });

  it("refetches notifications on every connect and reconnect", async () => {
    const { server } = seedServer([]);
    const { container, getByText } = mount(
      <>
        <Gate />
        <List />
      </>,
      { server },
    );
    await waitFor(() =>
      expect(server.count("GET", "/api/v1/notifications")).toBe(1),
    );
    await flush();

    act(() => getByText("open-stream").click());
    await waitFor(() => expect(server.streams).toHaveLength(1));
    await waitFor(() =>
      expect(server.count("GET", "/api/v1/notifications")).toBe(2),
    );
    expect(container.querySelector("ul")).not.toBeNull();

    await act(async () => {
      server.streams[0]!.end();
      await flush();
    });
    await waitFor(() => expect(server.streams).toHaveLength(2));
    await waitFor(() =>
      expect(server.count("GET", "/api/v1/notifications")).toBe(3),
    );
  });

  it("refetches when the tab becomes visible after the idle threshold, not before", async () => {
    const { server } = seedServer([]);
    const { getByText } = mount(
      <>
        <Gate idleThresholdMs={1000} />
        <List />
      </>,
      { server },
    );
    await waitFor(() =>
      expect(server.count("GET", "/api/v1/notifications")).toBe(1),
    );
    act(() => getByText("open-stream").click());
    await waitFor(() => expect(server.streams).toHaveLength(1));
    await waitFor(() =>
      expect(server.count("GET", "/api/v1/notifications")).toBe(2),
    );
    await flush();

    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-11-20T12:00:00Z"));
    let state: DocumentVisibilityState = "visible";
    vi.spyOn(document, "visibilityState", "get").mockImplementation(
      () => state,
    );
    const change = (next: DocumentVisibilityState) => {
      state = next;
      document.dispatchEvent(new Event("visibilitychange"));
    };

    const baseline = server.count("GET", "/api/v1/notifications");
    change("hidden");
    vi.setSystemTime(new Date("2026-11-20T12:00:00.500Z"));
    change("visible");
    await flush();
    expect(server.count("GET", "/api/v1/notifications")).toBe(baseline);

    change("hidden");
    vi.setSystemTime(new Date("2026-11-20T12:00:02Z"));
    change("visible");
    await waitFor(() =>
      expect(server.count("GET", "/api/v1/notifications")).toBeGreaterThan(
        baseline,
      ),
    );
  });

  it("stops the stream and clears the cache on resetWebCore", async () => {
    const { server } = seedServer([makeNotification("a")]);
    const { container } = mount(
      <>
        <Stream />
        <List />
      </>,
      { server },
    );
    await waitFor(() => expect(ids(container)).toEqual(["a"]));
    await waitFor(() => expect(server.streams).toHaveLength(1));

    act(() => resetWebCore(captured.queryClient!));
    expect(server.streams[0]?.signal?.aborted).toBe(true);
    expect(openNotificationStreamCount()).toBe(0);
    expect(
      captured.queryClient!.getQueryCache().findAll({
        queryKey: queryKeys.root,
      }),
    ).toHaveLength(0);
  });
});

describe("notification mutations", () => {
  const Actions = ({ id }: { id: string }) => {
    const read = useMarkNotificationRead();
    const readAll = useMarkAllNotificationsRead();
    return (
      <>
        <button onClick={() => read.mutate(id)}>read</button>
        <button onClick={() => readAll.mutate()}>read-all</button>
      </>
    );
  };

  const blockAfterFirstList = (server: FakeServer, list: Notification[]) => {
    let calls = 0;
    server.on("GET", "/api/v1/notifications", () => {
      calls += 1;
      if (calls > 1) return new Promise<Response>(() => undefined);
      return ok({ results: list, hasMore: false });
    });
  };

  it("marks one notification read optimistically", async () => {
    const server = new FakeServer();
    blockAfterFirstList(server, [makeNotification("a"), makeNotification("b")]);
    let resolve!: (response: Response) => void;
    server.on(
      "PATCH",
      "/api/v1/notifications/a/read",
      () => new Promise<Response>((r) => (resolve = r)),
    );
    const { container, getByText } = mount(
      <>
        <List />
        <Actions id="a" />
      </>,
      { server },
    );
    await waitFor(() => expect(ids(container)).toEqual(["a", "b"]));

    act(() => getByText("read").click());
    await waitFor(() =>
      expect(container.querySelector("li")?.getAttribute("data-read")).toBe(
        "true",
      ),
    );
    expect(container.querySelectorAll("li")[1]?.getAttribute("data-read")).toBe(
      "false",
    );
    resolve(ok({ id: "a" }));
  });

  it("rolls the optimistic update back when the request fails", async () => {
    const server = new FakeServer();
    blockAfterFirstList(server, [makeNotification("a")]);
    let reject!: () => void;
    server.on(
      "PATCH",
      "/api/v1/notifications/a/read",
      () => new Promise<Response>((r) => (reject = () => r(failure(500)))),
    );
    const { container, getByText } = mount(
      <>
        <List />
        <Actions id="a" />
      </>,
      { server },
    );
    await waitFor(() => expect(ids(container)).toEqual(["a"]));

    act(() => getByText("read").click());
    await waitFor(() =>
      expect(container.querySelector("li")?.getAttribute("data-read")).toBe(
        "true",
      ),
    );
    reject();
    await waitFor(() =>
      expect(container.querySelector("li")?.getAttribute("data-read")).toBe(
        "false",
      ),
    );
  });

  it("marks everything read optimistically, resets unread and rolls back on error", async () => {
    const server = new FakeServer();
    blockAfterFirstList(server, [makeNotification("a"), makeNotification("b")]);
    let fail!: () => void;
    server.on(
      "PATCH",
      "/api/v1/notifications/read-all",
      () => new Promise<Response>((r) => (fail = () => r(failure(500)))),
    );
    const { container, getByText } = mount(
      <>
        <List />
        <Actions id="a" />
      </>,
      { server },
    );
    await waitFor(() => expect(ids(container)).toEqual(["a", "b"]));
    const flags = () =>
      [...container.querySelectorAll("li")].map((li) =>
        li.getAttribute("data-read"),
      );

    act(() => getByText("read-all").click());
    await waitFor(() => expect(flags()).toEqual(["true", "true"]));
    fail();
    await waitFor(() => expect(flags()).toEqual(["false", "false"]));
    expect(
      server.calls.find((c) => c.path.endsWith("read-all"))?.search.get("role"),
    ).toBe("client");
  });

  it("keeps the page typed as the API envelope", async () => {
    const { server } = seedServer([makeNotification("a")]);
    mount(<List />, { server });
    await waitFor(() => {
      const page = captured.queryClient?.getQueryData<NotificationsPage>(
        queryKeys.notifications("client", undefined, {}),
      );
      expect(page?.hasMore).toBe(false);
    });
  });
});
