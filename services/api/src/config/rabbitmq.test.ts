import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  url: undefined as string | undefined,
  connected: true,
  close: vi.fn(),
  connectionClose: vi.fn(),
  connect: vi.fn(),
}));

vi.mock("./env.js", () => ({
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
  on: vi.fn(),
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
});
