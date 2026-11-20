import { describe, expect, it, vi } from "vitest";
import { BrowserApiError, getAdminJson } from "./browser-api";

const respond = (status: number, body: unknown) =>
  (async () =>
    new Response(JSON.stringify(body), { status })) as unknown as typeof fetch;

describe("getAdminJson", () => {
  it("returns data on success", async () => {
    await expect(
      getAdminJson("/x", { fetch: respond(200, { data: { a: 1 } }) }),
    ).resolves.toEqual({ a: 1 });
  });

  it("throws the API message and request id, and signals a 401", async () => {
    const onUnauthenticated = vi.fn();
    const error = await getAdminJson("/x", {
      fetch: respond(401, {
        message: "Expired.",
        code: "UNAUTHORIZED",
        requestId: "r1",
      }),
      onUnauthenticated,
    }).catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(BrowserApiError);
    expect(error).toMatchObject({
      message: "Expired.",
      status: 401,
      requestId: "r1",
    });
    expect(onUnauthenticated).toHaveBeenCalledTimes(1);
  });

  it("does not signal for other failures", async () => {
    const onUnauthenticated = vi.fn();
    await getAdminJson("/x", {
      fetch: respond(502, { message: "Bad." }),
      onUnauthenticated,
    }).catch(() => undefined);
    expect(onUnauthenticated).not.toHaveBeenCalled();
  });

  it("maps a network failure to a status 0 error", async () => {
    const failing = (async () => {
      throw new TypeError("down");
    }) as unknown as typeof fetch;
    await expect(getAdminJson("/x", { fetch: failing })).rejects.toMatchObject({
      status: 0,
    });
  });
});
