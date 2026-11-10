import type { db } from "../database/client.js";

export type DbExecutor = Pick<typeof db, "select" | "insert" | "update">;
