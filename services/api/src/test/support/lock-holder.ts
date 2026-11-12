import type { PoolClient } from "pg";
import { expect } from "vitest";
import { pool } from "../../database/client.js";

const BLOCKED_QUERIES = `
  select count(*)::int as blocked
  from pg_stat_activity a
  where a.datname = current_database()
    and a.wait_event_type = 'Lock'
    and a.query ilike $2
    and ($1::int = any(pg_blocking_pids(a.pid))
      or exists (
        select 1 from unnest(pg_blocking_pids(a.pid)) as b
        where $1::int = any(pg_blocking_pids(b))
      ))`;

export const countBlocked = async (holderPid: number, queryPattern: string) => {
  const result = await pool.query<{ blocked: number }>(BLOCKED_QUERIES, [
    holderPid,
    queryPattern,
  ]);
  return result.rows[0]?.blocked ?? 0;
};

export const waitForBlocked = async (
  holderPid: number,
  expected: number,
  queryPattern: string,
) => {
  const deadline = Date.now() + 8000;
  for (;;) {
    const blocked = await countBlocked(holderPid, queryPattern);
    if (blocked >= expected) return blocked;
    if (Date.now() > deadline) {
      throw new Error(
        `Expected ${expected} statements blocked on ${queryPattern}, saw ${blocked}`,
      );
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
};

export type LockHolder = {
  pid: number;
  release: () => Promise<void>;
};

export const openLockHolder = async (
  hold: (client: PoolClient) => Promise<void>,
): Promise<LockHolder> => {
  const client = await pool.connect();
  let released = false;
  const release = async () => {
    if (released) return;
    released = true;
    try {
      await client.query("rollback");
      client.release();
    } catch (error) {
      client.release(error as Error);
    }
  };
  try {
    await client.query("begin");
    await hold(client);
    const pidResult = await client.query<{ pid: number }>(
      "select pg_backend_pid() as pid",
    );
    return { pid: pidResult.rows[0]!.pid, release };
  } catch (error) {
    await release();
    throw error;
  }
};

const SAFE_IDENTIFIER = /^[a-z_][a-z0-9_]*$/;

export const holdRowLock =
  (table: string, id: string) => async (client: PoolClient) => {
    if (!SAFE_IDENTIFIER.test(table)) {
      throw new Error(`Unsafe table name: ${table}`);
    }
    await client.query(`select id from ${table} where id = $1 for update`, [
      id,
    ]);
  };

export const raceBlocked = async <T>(options: {
  hold: (client: PoolClient) => Promise<void>;
  queryPattern: string;
  starts: Array<() => Promise<T>>;
  ordered?: boolean;
}) => {
  const holder = await openLockHolder(options.hold);
  try {
    const pending: Array<Promise<PromiseSettledResult<T>>> = [];
    const start = (run: () => Promise<T>) =>
      Promise.allSettled([run()]).then(([settled]) => settled!);
    if (options.ordered) {
      for (const [index, run] of options.starts.entries()) {
        pending.push(start(run));
        expect(
          await waitForBlocked(holder.pid, index + 1, options.queryPattern),
        ).toBe(index + 1);
      }
    } else {
      for (const run of options.starts) pending.push(start(run));
      expect(
        await waitForBlocked(
          holder.pid,
          options.starts.length,
          options.queryPattern,
        ),
      ).toBe(options.starts.length);
    }
    await holder.release();
    return await Promise.all(pending);
  } finally {
    await holder.release();
  }
};
