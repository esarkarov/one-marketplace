import cron from "node-cron";
import { processDuePayouts } from "./payouts.service.js";
import { logger } from "../../config/logger.js";

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
          },
        });
        console.error("[payouts] Cron run threw unexpectedly:", error);
      }
    },
    {
      name: "freelancer-payouts",
      noOverlap: true,
    },
  );

  console.log(
    `[payouts] Hourly payout cron scheduled (${PAYOUT_CRON_EXPRESSION}).`,
  );
};

export const stopPayoutCron = async (): Promise<void> => {
  const task = payoutTask;
  payoutTask = undefined;
  await task?.destroy();
};
