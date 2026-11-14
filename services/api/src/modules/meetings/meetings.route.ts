import { Router } from "express";
import { dailyWebhookHandler } from "./controllers/meetings.controller.js";

export const meetingsRouter = Router();

meetingsRouter.post("/webhook", dailyWebhookHandler);
