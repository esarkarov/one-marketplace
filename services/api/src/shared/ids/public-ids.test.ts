import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ error: vi.fn() }));

vi.mock("../../config/logger.js", () => ({
  logger: { error: mocks.error },
}));

const { requirePublicId } = await import("./public-ids.js");

beforeEach(() => {
  mocks.error.mockReset();
  mocks.error.mockResolvedValue(undefined);
});

describe("requirePublicId", () => {
  it("returns a resolved id without logging", () => {
    expect(requirePublicId("uuid-1", "op", "row-1")).toBe("uuid-1");
    expect(mocks.error).not.toHaveBeenCalled();
  });

  it.each([null, undefined, ""])(
    "logs the operation and row id and throws a coded 500 for %s",
    (missing) => {
      expect(() => requirePublicId(missing, "jobs_get", "row-1")).toThrow(
        expect.objectContaining({
          statusCode: 500,
          code: "INTERNAL_ERROR",
          message: "Internal server error.",
        }),
      );
      expect(mocks.error).toHaveBeenCalledWith(
        expect.objectContaining({
          attributes: { operation: "jobs_get", "row.id": "row-1" },
        }),
      );
    },
  );
});
