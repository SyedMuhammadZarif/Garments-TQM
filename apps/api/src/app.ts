import express from 'express';
import type pg from 'pg';
import { API_BASE_PATH } from '@tqm/shared';
import { healthRouter } from './routes/health.js';

export type AppDeps = { pool: pg.Pool };

// Express app factory, kept separate from server.ts so tests can mount it without listening.
export function createApp({ pool }: AppDeps): express.Express {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', 'loopback, uniquelocal');
  app.use(express.json({ limit: '1mb' }));

  app.use(API_BASE_PATH, healthRouter(pool));

  app.use(API_BASE_PATH, (_req, res) => {
    res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Route not found' } });
  });

  return app;
}
