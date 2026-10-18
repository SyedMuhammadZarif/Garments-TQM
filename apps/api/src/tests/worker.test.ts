import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { startTestApp, type TestApp } from '../testing/testApp.js';
import { Worker } from '../jobs/worker.js';
import * as jobsRepo from '../repos/jobsRepo.js';
import { enqueueDue } from '../jobs/scheduler.js';

describe('background worker', () => {
  let t: TestApp;
  before(async () => {
    t = await startTestApp();
  });
  after(() => t.close());

  test('runs a job once, retries failures with backoff and marks them dead after max attempts', async () => {
    const seen: string[] = [];
    const worker = new Worker(t.pool, {
      ok: async () => {
        seen.push('ok');
      },
      boom: () => Promise.reject(new Error('kaput')),
    });
    await jobsRepo.enqueue(t.pool, { type: 'ok' });
    await jobsRepo.enqueue(t.pool, { type: 'boom', maxAttempts: 2 });
    await worker.tick();
    await worker.stop(0);
    assert.deepEqual(seen, ['ok']);

    const failed = await t.pool.query<{ status: string; attempts: number; last_error: string; delay: number }>(
      "select status, attempts, last_error, extract(epoch from run_at - now())::int as delay from jobs where type = 'boom'",
    );
    assert.equal(failed.rows[0]?.status, 'queued');
    assert.equal(failed.rows[0]?.last_error, 'kaput');
    assert.ok((failed.rows[0]?.delay ?? 0) >= 50); // 30 s × 2^1

    await t.pool.query("update jobs set run_at = now() where type = 'boom'");
    const w2 = new Worker(t.pool, { boom: () => Promise.reject(new Error('kaput')) });
    await w2.tick();
    await w2.stop(0);
    const dead = await t.pool.query<{ status: string }>("select status from jobs where type = 'boom'");
    assert.equal(dead.rows[0]?.status, 'dead');
  });

  test('stale running jobs are requeued', async () => {
    await t.pool.query("insert into jobs (type, status, locked_at) values ('stuck', 'running', now() - interval '11 minutes')");
    assert.equal(await jobsRepo.reapStale(t.pool, 10), 1);
  });

  test('the scheduler enqueues each recurring job once per bucket', async () => {
    const now = new Date('2026-10-18T05:10:00Z');
    await enqueueDue(t.pool, now);
    await enqueueDue(t.pool, now);
    const { rows } = await t.pool.query<{ n: number }>("select count(*)::int as n from jobs where type = 'cleanup.idempotency'");
    assert.equal(rows[0]?.n, 1);
  });
});
