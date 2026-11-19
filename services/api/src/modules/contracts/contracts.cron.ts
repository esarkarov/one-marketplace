import cron from "node-cron";
import { env } from "@/config/env.js";
import { logger } from "@/config/logger.js";
import { errorCodeForLog } from "@/shared/logging/sanitize-log.js";
import { reconcileCancelledContractRefunds } from "./services/contracts.refund-reconciliation.service.js";

const REFUND_RECONCILIATION_CRON_EXPRESSION = "*/15 * * * *";

let reconciliationTask: ReturnType<typeof cron.schedule> | undefined;
let inFlightRun: Promise<void> | undefined;

const errorTagForLog = (error: unknown): string =>
  errorCodeForLog(error) ??
  (error instanceof Error ? error.name : "UnknownError");

const logSafely = async (write: () => Promise<void>): Promise<void> => {
  try {
    await write();
  } catch {
    return;
  }
};

const runReconciliation = async (mode: "detect" | "on"): Promise<void> => {
  try {
    await reconcileCancelledContractRefunds({ mode });
  } catch (error) {
    await logSafely(() =>
      logger.error({
        message: "Refund reconciliation run failed",
        eventName: "refund.reconcile.failed",
        attributes: {
          "refund.reconcile_mode": mode,
          "error.code": errorTagForLog(error),
        },
      }),
    );
  }
};

const trackRun = async (mode: "detect" | "on"): Promise<void> => {
  if (inFlightRun) {
    await logSafely(() =>
      logger.debug({
        message: "Refund reconciliation tick skipped: previous run in flight",
        eventName: "refund.reconcile.skipped_overlap",
        attributes: { "refund.reconcile_mode": mode },
      }),
    );
    return;
  }

  const run: Promise<void> = runReconciliation(mode).finally(() => {
    if (inFlightRun === run) {
      inFlightRun = undefined;
    }
  });
  inFlightRun = run;
  await run;
};

export const startRefundReconciliationCron = () => {
  const mode = env.refundReconciliationMode;

  if (mode === "off") {
    void logger.info({
      message: "Refund reconciliation is disabled.",
      eventName: "refund.reconcile.disabled",
      attributes: { "refund.reconcile_mode": mode },
    });
    return;
  }

  if (reconciliationTask) {
    return;
  }

  reconciliationTask = cron.schedule(
    REFUND_RECONCILIATION_CRON_EXPRESSION,
    () => trackRun(mode),
    { name: "refund-reconciliation" },
  );

  void logger.info({
    message: "Refund reconciliation cron scheduled",
    eventName: "refund.reconcile.scheduled",
    attributes: {
      "cron.expression": REFUND_RECONCILIATION_CRON_EXPRESSION,
      "refund.reconcile_mode": mode,
    },
  });
};

export const stopRefundReconciliationCron = async (): Promise<void> => {
  const task = reconciliationTask;
  reconciliationTask = undefined;
  await task?.destroy();
};

export const waitForRefundReconciliationRun = async (): Promise<void> => {
  await inFlightRun;
};
