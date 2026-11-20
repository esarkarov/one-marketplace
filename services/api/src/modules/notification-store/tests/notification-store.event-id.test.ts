import { execFileSync } from "node:child_process";
import { describe, expect, it } from "vitest";
import { notificationEventId } from "@/modules/notification-store/utils/notification-store.event-id.js";
import { uuidV5 } from "@/shared/ids/uuid-v5.js";

const ENTITY = "00000000-0000-4000-8000-000000000001";

describe("notificationEventId", () => {
  it("returns the same id for the same inputs", () => {
    expect(notificationEventId("milestone-funded", ENTITY, "funded")).toBe(
      notificationEventId("milestone-funded", ENTITY, "funded"),
    );
  });

  it("returns a different id for a different transition", () => {
    expect(notificationEventId("contract", ENTITY, "accepted")).not.toBe(
      notificationEventId("contract", ENTITY, "cancelled"),
    );
  });

  it("returns a different id for a different kind or entity", () => {
    const base = notificationEventId("contract", ENTITY, "accepted");
    expect(notificationEventId("milestone", ENTITY, "accepted")).not.toBe(base);
    expect(
      notificationEventId(
        "contract",
        "00000000-0000-4000-8000-000000000002",
        "accepted",
      ),
    ).not.toBe(base);
  });

  it("is the uuid v5 of kind:entity:transition", () => {
    expect(notificationEventId("milestone-funded", ENTITY, "funded")).toBe(
      uuidV5(`milestone-funded:${ENTITY}:funded`),
    );
  });

  it("is a pinned value, so it does not change between releases", () => {
    expect(notificationEventId("milestone-funded", ENTITY, "funded")).toBe(
      "533f2941-5553-53b4-8abd-70dc1cb4ee1b",
    );
  });

  it("is stable across processes", () => {
    const script = `
      const { createHash } = require("node:crypto");
      const namespace = "6f0d7a3c-4b1e-5c8a-9d2f-1e3a5b7c9d0e";
      const hash = createHash("sha1")
        .update(Buffer.from(namespace.replaceAll("-", ""), "hex"))
        .update("milestone-funded:${ENTITY}:funded", "utf8")
        .digest();
      const bytes = hash.subarray(0, 16);
      bytes[6] = (bytes[6] & 0x0f) | 0x50;
      bytes[8] = (bytes[8] & 0x3f) | 0x80;
      const hex = bytes.toString("hex");
      process.stdout.write([hex.slice(0, 8), hex.slice(8, 12), hex.slice(12, 16), hex.slice(16, 20), hex.slice(20, 32)].join("-"));
    `;
    const fromOtherProcess = execFileSync(process.execPath, ["-e", script], {
      encoding: "utf8",
    });
    expect(notificationEventId("milestone-funded", ENTITY, "funded")).toBe(
      fromOtherProcess,
    );
  });

  it("rejects empty parts and the separator inside a part", () => {
    expect(() => notificationEventId("", ENTITY, "funded")).toThrow();
    expect(() => notificationEventId("kind", "", "funded")).toThrow();
    expect(() => notificationEventId("kind", ENTITY, "")).toThrow();
    expect(() => notificationEventId("a:b", ENTITY, "funded")).toThrow();
    expect(() => notificationEventId("kind", ENTITY, "x:y")).toThrow();
  });
});
