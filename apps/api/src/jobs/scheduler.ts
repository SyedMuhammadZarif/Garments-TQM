import type pg from 'pg';
import { logger } from '../lib/logger.js';
import * as jobsRepo from '../repos/jobsRepo.js';

// Enqueues recurring jobs (SPEC §12.2). dedupe_key = type + time bucket, so several API instances (or a
// restart) never enqueue the same run twice.
type Recurring = { type: string; bucket: (now: Date) => string };

const hourly = (now: Date) => now.toISOString().slice(0, 13);

export const RECURRING: Recurring[] = [{ type: 'cleanup.idempotency', bucket: hourly }];

export async function enqueueDue(pool: pg.Pool, now = new Date()): Promise<void> {
  for (const r of RECURRING) {
    await jobsRepo.enqueue(pool, { type: r.type, dedupeKey: `${r.type}:${r.bucket(now)}` });
  }
}

export function startScheduler(pool: pg.Pool): () => void {
  const run = () => enqueueDue(pool).catch((err: unknown) => logger.error('scheduler failed', { err: String(err) }));
  void run();
  const timer = setInterval(() => void run(), 60_000);
  return () => clearInterval(timer);
}
