import cron from "node-cron";
import { processDuePayouts } from "./payouts.service.js";
import { logger } from "../../config/logger.js";
import { errorLogAttributes } from "../../shared/utils/sanitize-log.js";

const PAYOUT_CRON_EXPRESSION = "0 * * * *";

let payoutTask: ReturnType<typeof cron.schedule> | undefined;

export const startPayoutCron = () => {
  payoutTask = cron.schedule(
    PAYOUT_CRON_EXPRESSION,
    async () => {
      try {
        await processDuePayouts();
      } catch (error) {
        await logger.error({
          message: "Scheduled task failed",
          eventName: "task.failed",
          attributes: {
            "task.name": "freelancer-payouts",
            "error.type": error instanceof Error ? error.name : "UnknownError",
            ...errorLogAttributes(error),
          },
        });
      }
    },
    {
      name: "freelancer-payouts",
      noOverlap: true,
    },
  );

  void logger.info({
    message: "Hourly payout cron scheduled",
    eventName: "payout.cron.scheduled",
    attributes: { "cron.expression": PAYOUT_CRON_EXPRESSION },
  });
};

export const stopPayoutCron = async (): Promise<void> => {
  const task = payoutTask;
  payoutTask = undefined;
  await task?.destroy();
};
