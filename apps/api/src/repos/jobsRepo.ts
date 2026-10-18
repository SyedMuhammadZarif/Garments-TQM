import type { Db } from '../db/tx.js';

export type JobRow = { id: string; type: string; payload: unknown; attempts: number; max_attempts: number };

export async function enqueue(
  db: Db,
  job: { type: string; payload?: unknown; runAt?: Date; priority?: number; dedupeKey?: string; maxAttempts?: number },
): Promise<boolean> {
  const { rowCount } = await db.query(
    `insert into jobs (type, payload, run_at, priority, dedupe_key, max_attempts)
     values ($1, $2, coalesce($3, now()), $4, $5, $6) on conflict (dedupe_key) do nothing`,
    [job.type, JSON.stringify(job.payload ?? {}), job.runAt ?? null, job.priority ?? 0, job.dedupeKey ?? null, job.maxAttempts ?? 5],
  );
  return rowCount === 1;
}

/** SPEC §12.1 claim query: SKIP LOCKED lets several workers share the queue safely. */
export async function claim(db: Db, workerId: string, max: number): Promise<JobRow[]> {
  const { rows } = await db.query<JobRow>(
    `update jobs set status = 'running', locked_at = now(), locked_by = $1, attempts = attempts + 1
      where id in (select id from jobs where status = 'queued' and run_at <= now()
                   order by priority desc, run_at limit $2 for update skip locked)
      returning id::text, type, payload, attempts, max_attempts`,
    [workerId, max],
  );
  return rows;
}

export async function markDone(db: Db, id: string): Promise<void> {
  await db.query("update jobs set status = 'done', finished_at = now(), locked_at = null, last_error = null where id = $1", [id]);
}

/** Retries with backoff 30 s × 2^attempts (max 1 h), or marks dead after max_attempts. */
export async function markFailed(db: Db, id: string, error: string): Promise<void> {
  await db.query(
    `update jobs set
        last_error = $2,
        locked_at = null,
        status = case when attempts < max_attempts then 'queued'::job_status else 'dead'::job_status end,
        run_at = case when attempts < max_attempts then now() + least(interval '30 seconds' * power(2, attempts), interval '1 hour') else run_at end,
        finished_at = case when attempts < max_attempts then null else now() end
      where id = $1`,
    [id, error.slice(0, 2000)],
  );
}

/** Jobs left 'running' by a crashed worker go back to the queue. */
export async function reapStale(db: Db, minutes: number): Promise<number> {
  const { rowCount } = await db.query(
    `update jobs set status = 'queued', locked_at = null, locked_by = null
      where status = 'running' and locked_at < now() - make_interval(mins => $1)`,
    [minutes],
  );
  return rowCount ?? 0;
}
