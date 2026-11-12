import type { NextFunction, Request, Response } from "express";
import { describe, expect, it, vi } from "vitest";

vi.mock("./jobs.service.js", () => ({}));

const {
  createClientJobPost,
  editClientJobPost,
  getClientJobPosts,
  removeClientJobPost,
} = await import("./jobs.controller.js");

const run = async (
  handler: (req: Request, res: Response, next: NextFunction) => void,
  role: string,
) => {
  const next = vi.fn();
  handler(
    { auth: { userId: "user_1", role }, body: {}, params: {} } as never,
    {} as Response,
    next,
  );
  await vi.waitFor(() => expect(next).toHaveBeenCalled());
  return next.mock.calls[0]![0] as { statusCode?: number; message: string };
};

describe("jobs controller client guard", () => {
  it.each([
    ["createClientJobPost", createClientJobPost],
    ["getClientJobPosts", getClientJobPosts],
    ["editClientJobPost", editClientJobPost],
    ["removeClientJobPost", removeClientJobPost],
  ])("%s rejects a freelancer with 403", async (_name, handler) => {
    const error = await run(handler, "freelancer");
    expect(error.statusCode).toBe(403);
    expect(error.message).toBe("A client account is required.");
  });
});
