import type { NextFunction, Request, Response } from "express";
import { context, trace } from "@opentelemetry/api";
import {
  InMemorySpanExporter,
  SimpleSpanProcessor,
  StackContextManager,
  TracerProvider,
} from "@opentelemetry/sdk-trace";
import { afterEach, describe, expect, it, vi } from "vitest";
import { requestIdMiddleware } from "./request-id.middleware.js";

const run = (incoming?: string) => {
  const request = {
    headers: incoming ? { "x-request-id": incoming } : {},
  } as unknown as Request;
  const setHeader = vi.fn();
  const response = { setHeader } as unknown as Response;
  const next = vi.fn() as NextFunction;
  requestIdMiddleware(request, response, next);
  return { request, setHeader, next };
};

afterEach(() => {
  trace.disable();
  context.disable();
});

describe("requestIdMiddleware", () => {
  it("keeps a valid incoming id and works without telemetry", () => {
    const { request, setHeader, next } = run("abc-123");

    expect(request.requestId).toBe("abc-123");
    expect(setHeader).toHaveBeenCalledWith("x-request-id", "abc-123");
    expect(next).toHaveBeenCalledTimes(1);
  });

  it("sets app.request_id on the active span", () => {
    const exporter = new InMemorySpanExporter();
    context.setGlobalContextManager(new StackContextManager().enable());
    trace.setGlobalTracerProvider(
      new TracerProvider({
        spanProcessors: [new SimpleSpanProcessor({ exporter })],
      }),
    );

    trace.getTracer("test").startActiveSpan("request", (span) => {
      run("req-42");
      span.end();
    });

    const [span] = exporter.getFinishedSpans();
    expect(span!.attributes["app.request_id"]).toBe("req-42");
  });
});
