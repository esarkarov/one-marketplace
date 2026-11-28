import { env } from "@/config/env.js";
import { pool } from "@/database/client.js";

export type TestOutboxMode = "off" | "shadow" | "on";

export const OUTBOX_MODES: TestOutboxMode[] = ["off", "shadow", "on"];

interface MutableOutboxEnv {
  outboxMode: TestOutboxMode;
  rabbitmqUrl: string | undefined;
}

const mutableEnv: MutableOutboxEnv = env;

const original = {
  outboxMode: env.outboxMode,
  rabbitmqUrl: env.rabbitmqUrl,
};

export const setOutboxMode = (mode: TestOutboxMode): void => {
  mutableEnv.outboxMode = mode;
  mutableEnv.rabbitmqUrl =
    mode === "off" ? original.rabbitmqUrl : "amqp://outbox-mode.test.invalid";
};

export const currentMode = (): TestOutboxMode => mutableEnv.outboxMode;

export const resetOutboxMode = (): void => {
  mutableEnv.outboxMode = original.outboxMode;
  mutableEnv.rabbitmqUrl = original.rabbitmqUrl;
};

export interface TestOutboxRow {
  event_id: string;
  status: string;
  payload: Record<string, unknown>;
}

export const outboxRows = async (
  eventIds: string[],
): Promise<TestOutboxRow[]> =>
  (
    await pool.query<TestOutboxRow>(
      "select event_id, status, payload from outbox_events where event_id = any($1::uuid[]) order by created_at, id",
      [eventIds],
    )
  ).rows;

export const deleteOutboxRows = async (eventIds: string[]): Promise<void> => {
  await pool.query(
    "delete from outbox_events where event_id = any($1::uuid[])",
    [eventIds],
  );
};

export const withoutEventId = (input: Record<string, unknown>) =>
  Object.fromEntries(
    Object.entries(input).filter(([key]) => key !== "eventId"),
  );
