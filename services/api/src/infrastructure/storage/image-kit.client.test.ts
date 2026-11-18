import { beforeEach, describe, expect, it, vi } from "vitest";

const hoisted = vi.hoisted(() => ({
  construct: vi.fn(),
  env: { imageKitPrivateKey: undefined as string | undefined },
}));

vi.mock("@imagekit/nodejs", () => ({
  default: class {
    files = { upload: vi.fn(), delete: vi.fn() };

    constructor(options: unknown) {
      hoisted.construct(options);
    }
  },
}));

vi.mock("../../config/env.js", () => ({ env: hoisted.env }));

const loadClient = async () => {
  vi.resetModules();
  return import("./image-kit.client.js");
};

describe("imageKit client", () => {
  beforeEach(() => {
    hoisted.construct.mockClear();
    hoisted.env.imageKitPrivateKey = undefined;
  });

  it("does not construct the SDK client when the module is imported", async () => {
    hoisted.env.imageKitPrivateKey = "private_test_key";

    await loadClient();

    expect(hoisted.construct).not.toHaveBeenCalled();
  });

  it("does not throw on import when the key is missing", async () => {
    await expect(loadClient()).resolves.toBeDefined();
    expect(hoisted.construct).not.toHaveBeenCalled();
  });

  it("fails with a clear error at call time when the key is missing", async () => {
    const { imageKit } = await loadClient();

    expect(() => imageKit.files).toThrow(
      "IMAGEKIT_PRIVATE_KEY is missing from the environment.",
    );
    expect(hoisted.construct).not.toHaveBeenCalled();
  });

  it("rejects an empty key instead of falling back to an empty string", async () => {
    hoisted.env.imageKitPrivateKey = "";
    const { imageKit } = await loadClient();

    expect(() => imageKit.files).toThrow(/IMAGEKIT_PRIVATE_KEY/);
    expect(hoisted.construct).not.toHaveBeenCalled();
  });

  it("constructs once with the configured key on first use", async () => {
    hoisted.env.imageKitPrivateKey = "private_test_key";
    const { imageKit } = await loadClient();

    void imageKit.files;
    void imageKit.files;

    expect(hoisted.construct).toHaveBeenCalledTimes(1);
    expect(hoisted.construct).toHaveBeenCalledWith({
      privateKey: "private_test_key",
    });
  });
});
