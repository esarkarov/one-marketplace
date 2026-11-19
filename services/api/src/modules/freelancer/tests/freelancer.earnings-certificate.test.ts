import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  renderEarningsCertificatePdf,
  signatureImageSource,
} from "../utils/earnings-certificate.pdf.js";

const data = {
  freelancerName: "Ada Lovelace",
  professionalTitle: "Backend developer",
  profileUrl: "https://example.test/talent/ada",
  location: "London, United Kingdom",
  activeSince: new Date("2025-01-10T00:00:00.000Z"),
  issuedAt: new Date("2026-03-01T00:00:00.000Z"),
  windows: [
    { label: "Last 12 months", totalCents: 1_250_000 },
    { label: "All time", totalCents: 2_500_000 },
  ],
};

afterEach(() => {
  vi.restoreAllMocks();
});

describe("earnings certificate signature image", () => {
  it("is a file: URL that points at the real asset", () => {
    expect(signatureImageSource.startsWith("file:")).toBe(true);
    expect(signatureImageSource.endsWith("/assets/signature.png")).toBe(true);
    expect(existsSync(fileURLToPath(signatureImageSource))).toBe(true);
  });

  it("resolves to the package assets folder from the built dist layout too", () => {
    const fromSource = new URL(signatureImageSource);
    const fromDist = new URL(
      "../../../../assets/signature.png",
      fromSource.href.replace(
        /\/assets\/signature\.png$/,
        "/dist/modules/freelancer/utils/earnings-certificate.pdf.js",
      ),
    );

    expect(fromDist.href).toBe(fromSource.href);
  });

  it("renders the signature without any failed fetch or warning", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const realFetch = globalThis.fetch;
    const fetched: string[] = [];
    vi.spyOn(globalThis, "fetch").mockImplementation((input, init) => {
      fetched.push(typeof input === "string" ? input : String(input));
      return realFetch(input, init);
    });

    const pdf = await renderEarningsCertificatePdf(data);

    expect(pdf.subarray(0, 4).toString()).toBe("%PDF");
    expect(pdf.toString("latin1")).toContain("/Subtype /Image");
    expect(warn).not.toHaveBeenCalled();
    expect(fetched.filter((target) => !target.startsWith("data:"))).toEqual([]);
  });
});
