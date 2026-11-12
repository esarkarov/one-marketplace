import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  url: undefined as string | undefined,
  connected: true,
  close: vi.fn(),
  connectionClose: vi.fn(),
  connect: vi.fn(),
  handlers: {} as Record<string, (payload?: unknown) => void>,
  info: vi.fn(),
  warn: vi.fn(),
}));

vi.mock("../config/logger.js", () => ({
  logger: { info: mocks.info, warn: mocks.warn },
}));

vi.mock("../config/env.js", () => ({
  env: {
    get rabbitmqUrl() {
      return mocks.url;
    },
  },
}));

vi.mock("amqp-connection-manager", () => ({
  default: { connect: mocks.connect },
}));

const makeConnection = () => ({
  on: (event: string, handler: (payload?: unknown) => void) => {
    mocks.handlers[event] = handler;
  },
  close: mocks.connectionClose,
  isConnected: () => mocks.connected,
  createChannel: vi.fn(() => ({
    on: vi.fn(),
    close: mocks.close,
  })),
});

const {
  closeRabbit,
  getRabbitConsumerChannel,
  getRabbitStatus,
  isRabbitConnected,
  isRabbitEnabled,
} = await import("./rabbitmq.js");

beforeEach(async () => {
  await closeRabbit(1);
  vi.resetAllMocks();
  mocks.url = "amqp://user:secret@localhost:5672";
  mocks.connected = true;
  mocks.connect.mockImplementation(makeConnection);
  mocks.handlers = {};
});

describe("rabbitmq config", () => {
  it("is disabled without a url and never connects", async () => {
    mocks.url = undefined;

    expect(isRabbitEnabled()).toBe(false);
    expect(await getRabbitStatus()).toEqual({ ok: false });
    expect(mocks.connect).not.toHaveBeenCalled();
  });

  it("reports not connected without creating a connection", async () => {
    expect(isRabbitConnected()).toBe(false);
    expect(await getRabbitStatus()).toEqual({ ok: false });
    expect(mocks.connect).not.toHaveBeenCalled();
  });

  it("reports ok only while the connection is up", async () => {
    getRabbitConsumerChannel();

    expect(await getRabbitStatus()).toEqual({ ok: true });

    mocks.connected = false;

    expect(isRabbitConnected()).toBe(false);
    expect(await getRabbitStatus()).toEqual({ ok: false });
    expect(mocks.connect).toHaveBeenCalledTimes(1);
  });

  it("closes channels then the connection", async () => {
    mocks.close.mockResolvedValue(undefined);
    mocks.connectionClose.mockResolvedValue(undefined);
    getRabbitConsumerChannel();

    await closeRabbit(1_000);

    expect(mocks.close).toHaveBeenCalled();
    expect(mocks.connectionClose).toHaveBeenCalledTimes(1);
    expect(isRabbitConnected()).toBe(false);
  });

  it("returns when closing hangs", async () => {
    mocks.close.mockReturnValue(new Promise(() => undefined));
    getRabbitConsumerChannel();

    await expect(closeRabbit(20)).resolves.toBeUndefined();
  });

  it("logs connect and reconnect as queue.connected at info level", () => {
    getRabbitConsumerChannel();

    mocks.handlers.connect!({ connection: {}, url: "amqp://user:secret@h" });
    mocks.handlers.connect!({ connection: {}, url: "amqp://user:secret@h" });

    expect(mocks.info).toHaveBeenCalledTimes(2);
    expect(mocks.info).toHaveBeenCalledWith({
      message: "RabbitMQ connected",
      eventName: "queue.connected",
      attributes: { "messaging.system": "rabbitmq" },
    });
    expect(JSON.stringify(mocks.info.mock.calls)).not.toContain("secret");
  });

  it("logs queue.disconnected at info level with no error text", () => {
    getRabbitConsumerChannel();

    mocks.handlers.disconnect!({
      err: new Error("amqp://user:secret@h reset"),
    });

    expect(mocks.info).toHaveBeenCalledWith({
      message: "RabbitMQ disconnected",
      eventName: "queue.disconnected",
      attributes: { "messaging.system": "rabbitmq" },
    });
    expect(JSON.stringify(mocks.info.mock.calls)).not.toContain("secret");
    expect(mocks.warn).toHaveBeenCalledTimes(1);
    expect(mocks.warn.mock.calls[0]![0].eventName).toBe(
      "queue.connection.lost",
    );
  });
});
