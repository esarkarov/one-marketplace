import { describe, expect, it } from "vitest";
import { formatDate, formatDateTime, formatRelative } from "./index";

describe("formatDate and formatDateTime", () => {
  it("formats in UTC with en-US by default", () => {
    expect(formatDate("2026-11-20T23:30:00.000Z")).toBe("Nov 20, 2026");
    expect(formatDateTime("2026-11-20T23:30:00.000Z")).toBe(
      "Nov 20, 2026, 11:30 PM",
    );
  });

  it("honors a time zone and locale", () => {
    expect(
      formatDate("2026-11-20T23:30:00.000Z", { timeZone: "Asia/Tokyo" }),
    ).toBe("Nov 21, 2026");
    expect(formatDate("2026-11-20T12:00:00.000Z", { locale: "de-DE" })).toBe(
      "20.11.2026",
    );
  });

  it.each([null, undefined, "", "not a date", "2026-13-45"])(
    "falls back for %j",
    (value) => {
      expect(formatDate(value)).toBe("—");
      expect(formatDateTime(value)).toBe("—");
      expect(formatRelative(value)).toBe("—");
    },
  );
});

describe("formatRelative", () => {
  const now = new Date("2026-11-20T12:00:00.000Z");

  it.each([
    ["2026-11-20T11:59:30.000Z", "30 seconds ago"],
    ["2026-11-20T11:55:00.000Z", "5 minutes ago"],
    ["2026-11-20T09:00:00.000Z", "3 hours ago"],
    ["2026-11-19T12:00:00.000Z", "yesterday"],
    ["2026-11-17T12:00:00.000Z", "3 days ago"],
    ["2026-11-20T14:00:00.000Z", "in 2 hours"],
    ["2025-11-20T12:00:00.000Z", "last year"],
    ["2026-11-20T12:00:00.000Z", "now"],
  ])("formats %s", (iso, expected) => {
    expect(formatRelative(iso, now)).toBe(expected);
  });
});
