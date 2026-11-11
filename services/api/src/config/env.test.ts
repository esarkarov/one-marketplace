import { describe, expect, it } from "vitest";

import { parseEnv } from "./env.js";

const base = {
  DATABASE_URL: "postgres://user:dbpass@localhost:5432/app",
  REDIS_URL: "redis://localhost:6379",
};

const errorOf = (source: Record<string, string | undefined>): string => {
  try {
    parseEnv(source);
  } catch (error) {
    return (error as Error).message;
  }
  throw new Error("expected parseEnv to throw");
};

describe("parseEnv", () => {
  it("parses the minimal env with defaults", () => {
    const env = parseEnv(base);

    expect(env.databaseUrl).toBe(base.DATABASE_URL);
    expect(env.redisUrl).toBe(base.REDIS_URL);
    expect(env.port).toBe(4000);
    expect(env.nodeEnv).toBe("development");
    expect(env.trustProxy).toBe(false);
    expect(env.rabbitmqUrl).toBeUndefined();
    expect(env.clerkSecretKey).toBeUndefined();
    expect(env.stripeSecretKey).toBeUndefined();
    expect(env.clientDashboard).toBeUndefined();
    expect(env.adminSessionSecret).toBeUndefined();
  });

  it("accepts postgresql:// and rediss:// URLs", () => {
    const env = parseEnv({
      DATABASE_URL: "postgresql://localhost/app",
      REDIS_URL: "rediss://localhost:6380",
    });

    expect(env.databaseUrl).toBe("postgresql://localhost/app");
    expect(env.redisUrl).toBe("rediss://localhost:6380");
  });

  it("reports both missing required variables in one error", () => {
    const message = errorOf({});

    expect(message).toContain("Missing or invalid required variables:");
    expect(message).toContain("- DATABASE_URL:");
    expect(message).toContain("- REDIS_URL:");
    expect(message).not.toContain("Invalid optional variables:");
  });

  it("reports an invalid DATABASE_URL protocol without echoing it", () => {
    const value = "mysql://root:supersecret@localhost/app";
    const message = errorOf({ ...base, DATABASE_URL: value });

    expect(message).toContain("- DATABASE_URL:");
    expect(message).not.toContain("- REDIS_URL:");
    expect(message).not.toContain(value);
    expect(message).not.toContain("supersecret");
  });

  it("reports an invalid REDIS_URL without echoing it", () => {
    const value = "http://:redissecret@localhost:6379";
    const message = errorOf({ ...base, REDIS_URL: value });

    expect(message).toContain("- REDIS_URL:");
    expect(message).not.toContain("- DATABASE_URL:");
    expect(message).not.toContain(value);
    expect(message).not.toContain("redissecret");
  });

  it("rejects a non-amqp RABBITMQ_URL without echoing it", () => {
    const value = "http://user:rabbitsecret@localhost:5672";
    const message = errorOf({ ...base, RABBITMQ_URL: value });

    expect(message).toContain("Invalid optional variables:");
    expect(message).toContain("- RABBITMQ_URL:");
    expect(message).not.toContain("rabbitsecret");
  });

  it("accepts amqps:// for RABBITMQ_URL", () => {
    expect(
      parseEnv({ ...base, RABBITMQ_URL: "amqps://broker.example.test" })
        .rabbitmqUrl,
    ).toBe("amqps://broker.example.test");
  });

  it("treats empty optional strings as unset", () => {
    const env = parseEnv({
      ...base,
      RABBITMQ_URL: "",
      CLERK_SECRET_KEY: "",
      STRIPE_SECRET_KEY: "",
      ADMIN_SESSION_SECRET: "",
      CLIENT_DASHBOARD: "",
      NODE_ENV: "",
      PORT: "",
    });

    expect(env.rabbitmqUrl).toBeUndefined();
    expect(env.clerkSecretKey).toBeUndefined();
    expect(env.stripeSecretKey).toBeUndefined();
    expect(env.adminSessionSecret).toBeUndefined();
    expect(env.clientDashboard).toBeUndefined();
    expect(env.nodeEnv).toBe("development");
    expect(env.port).toBe(4000);
  });

  it("passes optional values through when set", () => {
    const env = parseEnv({
      ...base,
      NODE_ENV: "staging",
      RABBITMQ_URL: "amqp://localhost:5672",
      CLIENT_DASHBOARD: "https://client.example.com",
    });

    expect(env.nodeEnv).toBe("staging");
    expect(env.rabbitmqUrl).toBe("amqp://localhost:5672");
    expect(env.clientDashboard).toBe("https://client.example.com");
  });

  describe("PORT", () => {
    it("uses a valid port", () => {
      expect(parseEnv({ ...base, PORT: "8080" }).port).toBe(8080);
    });

    it.each(["abc", "0", "65536", "80.5", "-1"])("rejects %s", (value) => {
      const message = errorOf({ ...base, PORT: value });

      expect(message).toContain("Invalid optional variables:");
      expect(message).toContain(
        "- PORT: PORT must be an integer between 1 and 65535.",
      );
      expect(message).not.toContain("Missing or invalid required");
    });
  });

  describe("TRUST_PROXY", () => {
    it.each([undefined, "", "false", "0"])("maps %s to false", (value) => {
      expect(parseEnv({ ...base, TRUST_PROXY: value }).trustProxy).toBe(false);
    });

    it("maps a positive integer to a number", () => {
      expect(parseEnv({ ...base, TRUST_PROXY: "2" }).trustProxy).toBe(2);
    });

    it("passes other strings through", () => {
      expect(parseEnv({ ...base, TRUST_PROXY: "loopback" }).trustProxy).toBe(
        "loopback",
      );
    });

    it.each(["true", "TRUE"])("rejects %s", (value) => {
      const message = errorOf({ ...base, TRUST_PROXY: value });

      expect(message).toContain(
        "- TRUST_PROXY: TRUST_PROXY=true trusts any client-supplied X-Forwarded-For; use a hop count or subnet list",
      );
    });
  });

  it("reports an invalid dashboard URL without echoing it", () => {
    const value = "not a url secret-host";
    const message = errorOf({ ...base, FREELANCER_DASHBOARD: value });

    expect(message).toContain("FREELANCER_DASHBOARD must be a valid URL.");
    expect(message).not.toContain(value);
    expect(message).not.toContain("secret-host");
  });

  it("reports several problems at once in one message", () => {
    const message = errorOf({
      DATABASE_URL: "mysql://u:pw1@h/db",
      PORT: "nope",
      TRUST_PROXY: "TRUE",
      ADMIN_DASHBOARD: "bad value pw2",
    });

    const requiredIndex = message.indexOf(
      "Missing or invalid required variables:",
    );
    const optionalIndex = message.indexOf("Invalid optional variables:");

    expect(requiredIndex).toBe(0);
    expect(optionalIndex).toBeGreaterThan(requiredIndex);
    expect(message).toContain("- DATABASE_URL:");
    expect(message).toContain("- REDIS_URL:");
    expect(message).toContain("- PORT:");
    expect(message).toContain("- TRUST_PROXY:");
    expect(message).toContain("ADMIN_DASHBOARD must be a valid URL.");
    expect(message).not.toContain("pw1");
    expect(message).not.toContain("pw2");
  });

  describe("production", () => {
    const production = {
      ...base,
      NODE_ENV: "production",
      CLERK_SECRET_KEY: "sk_live_clerk",
      STRIPE_SECRET_KEY: "sk_live_stripe",
      STRIPE_WEBHOOK_SECRET: "whsec_a",
      STRIPE_CONNECTS_WEBHOOK_SECRET: "whsec_b",
      STRIPE_IDENTITY_WEBHOOK_SECRET: "whsec_c",
      ADMIN_DASHBOARD_PASSWORD: "a-strong-admin-password",
      ADMIN_SESSION_SECRET: "s".repeat(32),
      CLIENT_DASHBOARD: "https://client.example.com",
    };

    it("accepts a complete production env", () => {
      expect(parseEnv(production).nodeEnv).toBe("production");
    });

    it("requires at least one dashboard origin", () => {
      for (const value of [undefined, ""]) {
        const message = errorOf({ ...production, CLIENT_DASHBOARD: value });

        expect(message).toContain("Invalid production variables:");
        expect(message).toContain("CLIENT_DASHBOARD, FREELANCER_DASHBOARD");
        expect(message).toContain("dashboard origin is required in production");
      }
    });

    it("accepts several valid dashboard origins", () => {
      const env = parseEnv({
        ...production,
        ADMIN_DASHBOARD: "http://admin.example.com:8080/x",
      });

      expect(env.adminDashboard).toBe("http://admin.example.com:8080/x");
    });

    it("rejects an invalid dashboard URL", () => {
      expect(
        errorOf({ ...production, CLIENT_DASHBOARD: "not a url" }),
      ).toContain("CLIENT_DASHBOARD");
      expect(
        errorOf({
          ...production,
          AGENCY_DASHBOARD: "ftp://agency.example.com",
        }),
      ).toContain("- AGENCY_DASHBOARD: must be a valid http(s) URL");
    });

    it("reports every missing required variable", () => {
      const message = errorOf({ ...base, NODE_ENV: "production" });

      expect(message).toContain("Invalid production variables:");
      for (const name of [
        "CLERK_SECRET_KEY",
        "STRIPE_SECRET_KEY",
        "STRIPE_WEBHOOK_SECRET",
        "STRIPE_CONNECTS_WEBHOOK_SECRET",
        "STRIPE_IDENTITY_WEBHOOK_SECRET",
        "ADMIN_DASHBOARD_PASSWORD",
        "ADMIN_SESSION_SECRET",
      ]) {
        expect(message).toContain(`- ${name}: is required in production`);
      }
    });

    it("rejects change-me values without echoing them", () => {
      const message = errorOf({
        ...production,
        STRIPE_SECRET_KEY: "sk_change-me-now",
      });

      expect(message).toContain(
        "- STRIPE_SECRET_KEY: must not be a placeholder",
      );
      expect(message).not.toContain("sk_change-me-now");
    });

    it("rejects a short ADMIN_SESSION_SECRET", () => {
      const message = errorOf({
        ...production,
        ADMIN_SESSION_SECRET: "short",
      });

      expect(message).toContain("- ADMIN_SESSION_SECRET: must be at least 32");
    });

    it("leaves non-production lenient", () => {
      for (const nodeEnv of ["development", "test", undefined]) {
        const env = parseEnv({
          ...base,
          NODE_ENV: nodeEnv,
          ADMIN_SESSION_SECRET: "short",
          STRIPE_SECRET_KEY: "change-me",
        });

        expect(env.adminSessionSecret).toBe("short");
        expect(env.clientDashboard).toBeUndefined();
      }
    });
  });
});
