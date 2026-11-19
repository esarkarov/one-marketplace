import { logger } from "@/config/logger.js";
import { errorLogAttributes } from "@/shared/logging/sanitize-log.js";
import {
  exitWithFlush,
  isShutdownInProgress,
  markShutdownFailed,
  shutdown,
  type ShutdownReason,
} from "./shutdown.js";

let registered = false;

export const handleFatalError = async (
  reason: Exclude<ShutdownReason, NodeJS.Signals>,
  error: unknown,
): Promise<void> => {
  markShutdownFailed();
  const alreadyShuttingDown = isShutdownInProgress();
  await logger
    .fatal({
      message: alreadyShuttingDown
        ? "Fatal error during shutdown."
        : "Fatal error. Starting graceful shutdown.",
      eventName: "system.crash",
      attributes: {
        "crash.source": reason,
        "error.name": error instanceof Error ? error.name : "UnknownError",
        ...errorLogAttributes(error),
      },
    })
    .catch(() => undefined);

  if (!alreadyShuttingDown) {
    await shutdown(reason).catch(() => exitWithFlush(1));
  }
};

export const registerCrashHandlers = (): void => {
  if (registered) {
    return;
  }

  registered = true;
  process.on("unhandledRejection", (reason) => {
    void handleFatalError("unhandledRejection", reason);
  });
  process.on("uncaughtException", (error) => {
    void handleFatalError("uncaughtException", error);
  });
};
