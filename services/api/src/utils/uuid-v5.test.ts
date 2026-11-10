import { describe, expect, it } from "vitest";
import { PROJECT_UUID_NAMESPACE, uuidV5 } from "./uuid-v5.js";

const DNS_NAMESPACE = "6ba7b810-9dad-11d1-80b4-00c04fd430c8";

describe("uuidV5", () => {
  it("matches the RFC 4122 reference vector", () => {
    expect(uuidV5("www.example.com", DNS_NAMESPACE)).toBe(
      "2ed6657d-e927-568b-95e1-2665a8aea6a2",
    );
    expect(uuidV5("python.org", DNS_NAMESPACE)).toBe(
      "886313e1-3b8a-5372-9b90-0c9aee199e5d",
    );
  });

  it("is deterministic and version 5", () => {
    const first = uuidV5("payout-id");
    expect(uuidV5("payout-id")).toBe(first);
    expect(first).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
  });

  it("differs per name and namespace", () => {
    expect(uuidV5("a")).not.toBe(uuidV5("b"));
    expect(uuidV5("a")).not.toBe(uuidV5("a", DNS_NAMESPACE));
  });

  it("uses a valid namespace uuid", () => {
    expect(PROJECT_UUID_NAMESPACE).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
    );
  });
});
