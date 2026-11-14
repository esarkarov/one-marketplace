import { describe, expect, it } from "vitest";
import type { DbExecutor } from "../../database/db-executor.js";
import { ApiError } from "../../shared/http/api-error.js";
import { openInterviewConversation } from "./messaging.public.js";

const queuedExecutor = (results: unknown[][]) => {
  const queue = [...results];
  const chain: unknown = new Proxy(function chainTarget() {}, {
    get: (_target, property) =>
      property === "then"
        ? (resolve: (rows: unknown[]) => unknown) =>
            resolve(queue.shift() ?? [])
        : chain,
    apply: () => chain,
  });
  return chain as DbExecutor;
};

const input = {
  proposalId: "proposal-1",
  jobId: "job-1",
  contextKey: "job:job-1:client:client-1:talent:freelancer-1",
  clientId: "client-1",
  senderAccountId: "freelancer-1",
  counterparty: { accountId: "freelancer-1" },
  coverLetter: "cover",
  openingMessage: "hello",
};

const rejection = async (results: unknown[][]) => {
  const error = await openInterviewConversation(
    queuedExecutor(results),
    input,
  ).then(
    () => undefined,
    (caught: unknown) => caught,
  );
  expect(error).toBeInstanceOf(ApiError);
  return error as ApiError;
};

describe("openInterviewConversation empty inserts", () => {
  it("answers 500 when the conversation can be neither created nor found", async () => {
    const error = await rejection([[], []]);
    expect(error.statusCode).toBe(500);
    expect(error.message).toBe("Conversation could not be created.");
    expect(error.code).toBeUndefined();
  });

  it("answers 500 when the proposal message insert returns no row", async () => {
    const error = await rejection([[{ id: "conversation-1" }], [], []]);
    expect(error.statusCode).toBe(500);
    expect(error.message).toBe("Interview messages could not be created.");
  });

  it("answers 500 when the opening message insert returns no row", async () => {
    const error = await rejection([
      [{ id: "conversation-1" }],
      [],
      [{ id: "message-1", created_at: new Date() }],
      [],
    ]);
    expect(error.statusCode).toBe(500);
    expect(error.message).toBe("Interview messages could not be created.");
  });

  it("resolves with the conversation id when every insert returns a row", async () => {
    const now = new Date();
    const result = await openInterviewConversation(
      queuedExecutor([
        [{ id: "conversation-1" }],
        [],
        [{ id: "message-1", created_at: now }],
        [{ id: "message-2", created_at: now }],
      ]),
      input,
    );
    expect(result).toEqual({ conversationId: "conversation-1" });
  });
});
