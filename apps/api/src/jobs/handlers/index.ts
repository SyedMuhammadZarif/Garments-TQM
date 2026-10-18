import type pg from 'pg';
import { cleanupIdempotency } from './cleanupIdempotency.js';

export type JobContext = { pool: pg.Pool; payload: unknown };
export type JobHandler = (ctx: JobContext) => Promise<void>;

// One entry per job type (SPEC §12.2). More handlers arrive with their milestones.
export const handlers: Record<string, JobHandler> = {
  'cleanup.idempotency': cleanupIdempotency,
};
