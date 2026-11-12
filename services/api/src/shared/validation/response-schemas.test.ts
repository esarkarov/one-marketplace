import { describe, expect, it } from "vitest";
import { z } from "zod";

import {
  BadRequestBody,
  ErrorBody,
  InternalErrorBody,
  RateLimitBody,
  ValidationErrorBody,
  cents,
  cursorPage,
  isoDateTime,
  ok,
  okNoData,
  offsetPage,
} from "./response-schemas.js";

describe("response schemas", () => {
  it("ok wraps data strictly", () => {
    const schema = ok(z.strictObject({ id: z.string() }));
    expect(
      schema.safeParse({ success: true, message: "Done", data: { id: "a" } })
        .success,
    ).toBe(true);
    expect(
      schema.safeParse({
        success: true,
        message: "Done",
        data: { id: "a" },
        extra: 1,
      }).success,
    ).toBe(false);
    expect(
      schema.safeParse({
        success: true,
        message: "Done",
        data: { id: "a", extra: 1 },
      }).success,
    ).toBe(false);
    expect(okNoData.safeParse({ success: true, message: "Done" }).success).toBe(
      true,
    );
  });

  it("ErrorBody accepts optional code and errors and rejects drift", () => {
    expect(ErrorBody.safeParse({ success: false, message: "No" }).success).toBe(
      true,
    );
    expect(
      ErrorBody.safeParse({
        success: false,
        message: "No",
        code: "X",
        errors: [{ path: "body.a", message: "Bad" }],
      }).success,
    ).toBe(true);
    expect(
      ErrorBody.safeParse({ success: false, message: "No", stack: "x" })
        .success,
    ).toBe(false);
  });

  it("ValidationErrorBody caps errors at 50", () => {
    const error = { path: "body.a", message: "Bad" };
    const base = {
      success: false,
      message: "Bad",
      code: "VALIDATION_ERROR",
    };
    expect(
      ValidationErrorBody.safeParse({ ...base, errors: [error] }).success,
    ).toBe(true);
    expect(
      ValidationErrorBody.safeParse({
        ...base,
        errors: Array.from({ length: 51 }, () => error),
      }).success,
    ).toBe(false);
    expect(
      ValidationErrorBody.safeParse({
        ...base,
        code: "OTHER",
        errors: [error],
      }).success,
    ).toBe(false);
    expect(
      ValidationErrorBody.safeParse({
        ...base,
        errors: [{ ...error, extra: 1 }],
      }).success,
    ).toBe(false);
  });

  it("InternalErrorBody and RateLimitBody require requestId", () => {
    expect(
      InternalErrorBody.safeParse({
        success: false,
        message: "Internal server error.",
        requestId: "abc",
      }).success,
    ).toBe(true);
    expect(
      InternalErrorBody.safeParse({
        success: false,
        message: "Internal server error.",
      }).success,
    ).toBe(false);
    expect(
      RateLimitBody.safeParse({
        success: false,
        message: "Too many requests. Please try again later.",
        requestId: "abc",
      }).success,
    ).toBe(true);
    expect(
      RateLimitBody.safeParse({
        success: false,
        message: "Too many requests. Please try again later.",
        requestId: "abc",
        extra: 1,
      }).success,
    ).toBe(false);
  });

  it("cents accepts safe non-negative integers only", () => {
    expect(cents.safeParse(0).success).toBe(true);
    expect(cents.safeParse(Number.MAX_SAFE_INTEGER).success).toBe(true);
    expect(cents.safeParse(1.5).success).toBe(false);
    expect(cents.safeParse(-1).success).toBe(false);
    expect(cents.safeParse(Number.MAX_SAFE_INTEGER + 1).success).toBe(false);
  });

  it("isoDateTime rejects non-ISO strings", () => {
    expect(isoDateTime.safeParse("2026-01-02T03:04:05.000Z").success).toBe(
      true,
    );
    expect(isoDateTime.safeParse("02/01/2026").success).toBe(false);
    expect(isoDateTime.safeParse(1700000000).success).toBe(false);
  });

  it("offsetPage and cursorPage are strict", () => {
    const offset = offsetPage(z.string());
    expect(offset.safeParse({ results: ["a"], hasMore: false }).success).toBe(
      true,
    );
    expect(
      offset.safeParse({ results: ["a"], hasMore: false, total: 1 }).success,
    ).toBe(false);

    const cursor = cursorPage("messages", z.string());
    expect(
      cursor.safeParse({ messages: ["a"], nextCursor: null }).success,
    ).toBe(true);
    expect(
      cursor.safeParse({ messages: ["a"], nextCursor: "c", extra: 1 }).success,
    ).toBe(false);
    expect(cursor.safeParse({ messages: ["a"], nextCursor: 5 }).success).toBe(
      false,
    );
  });

  it("BadRequestBody accepts validation and plain error bodies", () => {
    expect(
      BadRequestBody.safeParse({
        success: false,
        message: "Invalid request.",
        code: "VALIDATION_ERROR",
        errors: [{ path: "body.title", message: "Required" }],
      }).success,
    ).toBe(true);
    expect(
      BadRequestBody.safeParse({ success: false, message: "Bad request." })
        .success,
    ).toBe(true);
  });

  it("BadRequestBody rejects drift", () => {
    expect(
      BadRequestBody.safeParse({ success: true, message: "Nope" }).success,
    ).toBe(false);
    expect(
      BadRequestBody.safeParse({
        success: false,
        message: "Bad request.",
        extra: 1,
      }).success,
    ).toBe(false);
  });
});
