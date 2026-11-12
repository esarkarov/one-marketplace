import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  selectRows: [] as unknown[],
  updateError: null as Error | null,
  updateRows: [] as unknown[],
  upload: vi.fn(),
  deleteFile: vi.fn(),
  logError: vi.fn(),
}));

vi.mock("../../config/env.js", () => ({
  env: { imageKitPrivateKey: "ik_test", nodeEnv: "test" },
}));

vi.mock("../../config/logger.js", () => ({
  logger: { error: mocks.logError, warn: async () => undefined },
}));

vi.mock("../../infrastructure/image-kit.js", () => ({
  imageKit: {
    files: { upload: mocks.upload, delete: mocks.deleteFile },
  },
}));

vi.mock("@clerk/backend", () => ({ createClerkClient: () => ({}) }));

vi.mock("../../database/client.js", () => {
  const chain: Record<string, unknown> = {};
  for (const method of ["select", "from", "where", "update", "set"]) {
    chain[method] = () => chain;
  }
  chain.limit = async () => mocks.selectRows;
  chain.returning = async () => {
    if (mocks.updateError) throw mocks.updateError;
    return mocks.updateRows;
  };
  return { db: chain };
});

const { updateJobPost } = await import("./jobs.service.js");
const { errorHandler } = await import("../../shared/http/error.middleware.js");

const existingJob = { id: "job_1", attachments: [] };
const newAttachment = {
  fileId: "",
  fileName: "brief.pdf",
  fileUrl: "data:application/pdf;base64,AAAA",
  fileType: "application/pdf",
  fileSize: 3,
};

beforeEach(() => {
  mocks.selectRows = [existingJob];
  mocks.updateError = null;
  mocks.updateRows = [{ id: "job_1" }];
  mocks.upload.mockReset();
  mocks.upload.mockResolvedValue({ fileId: "file_1", url: "https://cdn/f" });
  mocks.deleteFile.mockReset();
  mocks.deleteFile.mockResolvedValue(undefined);
  mocks.logError.mockReset();
  mocks.logError.mockResolvedValue(undefined);
});

describe("updateJobPost", () => {
  it("returns the updated job", async () => {
    await expect(updateJobPost("user_1", "job_1", {})).resolves.toEqual({
      id: "job_1",
    });
    expect(mocks.deleteFile).not.toHaveBeenCalled();
  });

  it("returns 404 when no editable job exists", async () => {
    mocks.selectRows = [];

    await expect(updateJobPost("user_1", "job_1", {})).rejects.toMatchObject({
      statusCode: 404,
    });
  });

  it("returns 404 and removes uploaded files when the update matches no row", async () => {
    mocks.updateRows = [];

    await expect(
      updateJobPost("user_1", "job_1", { attachments: [newAttachment] }),
    ).rejects.toMatchObject({ statusCode: 404 });

    expect(mocks.deleteFile).toHaveBeenCalledWith("file_1");
  });

  it("rethrows database errors without mapping them to 404 and removes uploads", async () => {
    mocks.updateError = new Error("connection terminated");

    const error = await updateJobPost("user_1", "job_1", {
      attachments: [newAttachment],
    }).catch((caught: unknown) => caught);

    expect(error).toBe(mocks.updateError);
    expect(error).not.toHaveProperty("statusCode");
    expect(mocks.deleteFile).toHaveBeenCalledWith("file_1");
  });

  it("surfaces database errors as a sanitized 500 with a sanitized log", async () => {
    mocks.updateError = new Error(
      "Failed query: update job_posts set secret_column = 'x'",
    );
    const app = express();
    app.put("/jobs", async (_req, _res, next) => {
      try {
        await updateJobPost("user_1", "job_1", {});
      } catch (error) {
        next(error);
      }
    });
    app.use(errorHandler);

    const response = await request(app).put("/jobs");

    expect(response.status).toBe(500);
    expect(response.body).toMatchObject({
      success: false,
      message: "Internal server error.",
    });
    expect(JSON.stringify(response.body)).not.toContain("secret_column");
    expect(mocks.logError).toHaveBeenCalledOnce();
    const payload = mocks.logError.mock.calls[0]![0];
    expect(payload.attributes["error.message"]).toBe("Database query failed");
  });
});
