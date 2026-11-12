import type { db } from "./client.js";

export type DbExecutor = Pick<typeof db, "select" | "insert" | "update">;
