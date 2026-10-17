import { Router } from 'express';
import type pg from 'pg';
import type { HealthStatus } from '@tqm/shared';

export function healthRouter(pool: pg.Pool): Router {
  const router = Router();

  router.get('/health', async (_req, res) => {
    let db: HealthStatus['db'] = 'ok';
    try {
      await pool.query('select 1');
    } catch {
      db = 'down';
    }
    const body: HealthStatus = {
      status: db === 'ok' ? 'ok' : 'degraded',
      db,
      time: new Date().toISOString(),
    };
    res.status(db === 'ok' ? 200 : 503).json({ data: body });
  });

  return router;
}
