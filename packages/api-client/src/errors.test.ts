import { describe, expect, it } from "vitest";
import {
  ApiError,
  createApiClient,
  errorMessage,
  isApiError,
  unwrap,
} from "./index";

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });

const clientFor = (respond: () => Response | Promise<Response>) =>
  createApiClient({
    baseUrl: "http://api.test",
    getToken: async () => null,
    fetch: (async () => respond()) as unknown as typeof fetch,
  });

const caught = async (promise: Promise<unknown>): Promise<unknown> => {
  try {
    await promise;
  } catch (error) {
    return error;
  }
  throw new Error("expected a rejection");
};

describe("error handling", () => {
  it("parses the API error body", async () => {
    const client = clientFor(() =>
      json(400, {
        success: false,
        message: "Invalid input.",
        code: "VALIDATION_ERROR",
        requestId: "req-1",
        errors: [{ path: "title", message: "Required" }],
      }),
    );
    const error = await caught(unwrap(client.GET("/api/v1/jobs/public")));

    expect(isApiError(error)).toBe(true);
    expect(error).toMatchObject({
      status: 400,
      code: "VALIDATION_ERROR",
      requestId: "req-1",
      message: "Invalid input.",
      errors: [{ path: "title", message: "Required" }],
    });
  });

  it("turns an HTML 502 into HTTP_ERROR with a generic message", async () => {
    const client = clientFor(
      () =>
        new Response("<html><body>Bad gateway secret-detail</body></html>", {
          status: 502,
          headers: { "content-type": "text/html" },
        }),
    );
    const error = (await caught(
      unwrap(client.GET("/api/v1/jobs/public")),
    )) as ApiError;

    expect(error).toMatchObject({ status: 502, code: "HTTP_ERROR" });
    expect(error.message).not.toContain("secret-detail");
    expect(errorMessage(error)).not.toContain("secret-detail");
  });

  it("turns an empty 500 into HTTP_ERROR", async () => {
    const client = clientFor(() => new Response(null, { status: 500 }));
    const error = await caught(unwrap(client.GET("/api/v1/jobs/public")));

    expect(error).toMatchObject({ status: 500, code: "HTTP_ERROR" });
  });

  it("turns a fetch failure into NETWORK_ERROR with status 0", async () => {
    const client = clientFor(() => {
      throw new TypeError("fetch failed");
    });
    const error = await caught(client.GET("/api/v1/jobs/public"));

    expect(isApiError(error)).toBe(true);
    expect(error).toMatchObject({ status: 0, code: "NETWORK_ERROR" });
  });

  it("rethrows an AbortError untouched", async () => {
    const abort = new DOMException("The operation was aborted.", "AbortError");
    const client = clientFor(() => {
      throw abort;
    });
    const error = await caught(client.GET("/api/v1/jobs/public"));

    expect(error).toBe(abort);
    expect(isApiError(error)).toBe(false);
  });
});

describe("unwrap", () => {
  it("returns data from the success envelope", async () => {
    const client = clientFor(() =>
      json(200, {
        success: true,
        message: "OK",
        data: { results: [], hasMore: false },
      }),
    );
    const data = await unwrap(client.GET("/api/v1/jobs/public"));

    expect(data).toEqual({ results: [], hasMore: false });
    expect(data.hasMore).toBe(false);
  });

  it("throws on a 2xx body with success false", async () => {
    const client = clientFor(() =>
      json(200, {
        success: false,
        message: "Nope",
        code: "SOME_CODE",
        requestId: "r2",
      }),
    );
    const error = await caught(unwrap(client.GET("/api/v1/jobs/public")));

    expect(error).toMatchObject({ status: 200, code: "SOME_CODE" });
  });

  it("throws on success false even when the body carries a data field", async () => {
    const client = clientFor(() =>
      json(200, {
        success: false,
        message: "Nope",
        code: "SOME_CODE",
        requestId: "r3",
        data: { leaked: true },
      }),
    );
    const error = await caught(unwrap(client.GET("/api/v1/jobs/public")));

    expect(error).toMatchObject({ code: "SOME_CODE", requestId: "r3" });
  });

  it("throws UNEXPECTED_RESPONSE on a 2xx body that is no envelope", async () => {
    const client = clientFor(() => json(200, { hello: "world" }));
    const error = await caught(unwrap(client.GET("/api/v1/jobs/public")));

    expect(error).toMatchObject({ code: "UNEXPECTED_RESPONSE" });
  });
});

describe("errorMessage", () => {
  const apiError = (status: number, code: string, message: string) =>
    new ApiError({ status, code, message });

  it("shows the API message for a 4xx with a code", () => {
    expect(
      errorMessage(apiError(409, "JOB_LOCKED", "The job is locked.")),
    ).toBe("The job is locked.");
  });

  it("never shows a 5xx message", () => {
    const message = errorMessage(
      apiError(500, "INTERNAL_ERROR", "db password"),
    );

    expect(message).not.toContain("db password");
    expect(message).toMatch(/something went wrong/i);
  });

  it("uses the generic text for a 4xx without an API body", () => {
    expect(errorMessage(apiError(404, "HTTP_ERROR", "Request failed"))).toMatch(
      /something went wrong/i,
    );
  });

  it("uses a network text for status 0", () => {
    expect(errorMessage(apiError(0, "NETWORK_ERROR", "x"))).toMatch(
      /could not reach/i,
    );
  });

  it("never exposes a plain Error or a string", () => {
    expect(errorMessage(new Error("stack secret"))).not.toContain("secret");
    expect(errorMessage("raw body secret")).not.toContain("secret");
  });
});
