import { env } from "@/config/env.js";

if (env.telemetryMode !== "off") {
  const { register } = await import("import-in-the-middle/register-hooks.mjs");
  const { INSTRUMENTED_PACKAGES, startTelemetry } =
    await import("@/infrastructure/telemetry/sdk.js");
  register({ include: [...INSTRUMENTED_PACKAGES] });
  await startTelemetry({
    mode: env.telemetryMode,
    endpoint: env.otlpEndpoint,
    serviceName: env.telemetryServiceName,
  });
}
