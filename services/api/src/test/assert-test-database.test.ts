import { describe, expect, it } from "vitest";
import {
  assertTestDatabase,
  parseDatabaseName,
} from "./assert-test-database.js";

const url = (name: string) =>
  `postgresql://user:s3cret-pass@localhost:5432/${name}`;

describe("assertTestDatabase", () => {
  it("accepts a name ending in _test", () => {
    expect(() => assertTestDatabase(url("onemarketplace_test"))).not.toThrow();
  });

  it("rejects the development database", () => {
    expect(() => assertTestDatabase(url("onemarketplace"))).toThrow(
      /"onemarketplace"/,
    );
  });

  it("rejects a name that does not end in _test", () => {
    expect(() => assertTestDatabase(url("other"))).toThrow(/_test/);
  });

  it("rejects a name equal to POSTGRES_DB", () => {
    expect(() => assertTestDatabase(url("custom_test"), "custom_test")).toThrow(
      /Refusing/,
    );
  });

  it("rejects a missing or invalid url", () => {
    expect(() => assertTestDatabase(undefined)).toThrow(/missing or invalid/);
    expect(() => assertTestDatabase("not a url")).toThrow(/missing or invalid/);
    expect(() => assertTestDatabase("postgresql://localhost:5432/")).toThrow(
      /missing or invalid/,
    );
  });

  it("does not leak the password or url, and names the fix", () => {
    let message = "";
    try {
      assertTestDatabase(url("onemarketplace"));
    } catch (error) {
      message = (error as Error).message;
    }
    expect(message).not.toContain("s3cret-pass");
    expect(message).not.toContain("postgresql://user");
    expect(message).toContain("db:test:setup");
    expect(message).toContain("onemarketplace_test");
  });

  it("parses the database name", () => {
    expect(parseDatabaseName(url("abc_test"))).toBe("abc_test");
  });
});
