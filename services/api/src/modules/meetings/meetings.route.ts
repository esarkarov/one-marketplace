import { Router } from "express";
import { dailyWebhookHandler } from "./meetings.controller.js";

export const meetingsRouter = Router();

meetingsRouter.post("/webhook", dailyWebhookHandler);
