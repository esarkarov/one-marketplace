import { handleStartupFailure, start } from "./bootstrap/start.js";
import { shutdown } from "./bootstrap/shutdown.js";

process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));

void start().catch(handleStartupFailure);
