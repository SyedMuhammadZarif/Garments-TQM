import { hostname } from 'node:os';
import type pg from 'pg';
import { logger } from '../lib/logger.js';
import * as jobsRepo from '../repos/jobsRepo.js';
import type { JobHandler } from './handlers/index.js';

// Polling worker (SPEC §12.1). Runs inside the API process when WORKER_ENABLED=true.
const POLL_MS = 1_000;
const BATCH = 5;
const REAP_EVERY_MS = 60_000;
const STALE_MINUTES = 10;

export class Worker {
  private timer: NodeJS.Timeout | null = null;
  private stopping = false;
  private running = new Set<Promise<void>>();
  private lastReap = 0;
  readonly id = `${hostname()}:${process.pid}`;

  constructor(
    private readonly pool: pg.Pool,
    private readonly handlers: Record<string, JobHandler>,
  ) {}

  start(): void {
    this.schedule(0);
  }

  private schedule(ms: number): void {
    if (this.stopping) return;
    this.timer = setTimeout(() => void this.tick(), ms);
  }

  /** One poll: reap stale jobs occasionally, claim a batch, run it. Exposed for tests. */
  async tick(): Promise<number> {
    let claimed = 0;
    try {
      if (Date.now() - this.lastReap > REAP_EVERY_MS) {
        this.lastReap = Date.now();
        const reaped = await jobsRepo.reapStale(this.pool, STALE_MINUTES);
        if (reaped) logger.warn('requeued stale jobs', { count: reaped });
      }
      const jobs = await jobsRepo.claim(this.pool, this.id, BATCH);
      claimed = jobs.length;
      await Promise.all(jobs.map((job) => this.track(this.run(job))));
    } catch (err) {
      logger.error('worker tick failed', { err: String(err) });
    } finally {
      this.schedule(POLL_MS);
    }
    return claimed;
  }

  private track(p: Promise<void>): Promise<void> {
    this.running.add(p);
    return p.finally(() => this.running.delete(p));
  }

  private async run(job: jobsRepo.JobRow): Promise<void> {
    const handler = this.handlers[job.type];
    try {
      if (!handler) throw new Error(`No handler for job type "${job.type}"`);
      await handler({ pool: this.pool, payload: job.payload });
      await jobsRepo.markDone(this.pool, job.id);
    } catch (err) {
      logger.error('job failed', { jobId: job.id, type: job.type, attempt: job.attempts, err: String(err) });
      await jobsRepo.markFailed(this.pool, job.id, err instanceof Error ? err.message : String(err));
    }
  }

  /** Stops claiming and waits up to 30 s for running jobs (SPEC §12.1). */
  async stop(timeoutMs = 30_000): Promise<void> {
    this.stopping = true;
    if (this.timer) clearTimeout(this.timer);
    await Promise.race([Promise.allSettled([...this.running]), new Promise((r) => setTimeout(r, timeoutMs))]);
  }
}
