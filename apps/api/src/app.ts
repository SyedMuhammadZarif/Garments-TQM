import express from 'express';
import type pg from 'pg';
import { API_BASE_PATH } from '@tqm/shared';
import type { Config } from './config.js';
import { requestId } from './middleware/requestId.js';
import { securityHeaders } from './middleware/securityHeaders.js';
import { cors } from './middleware/cors.js';
import { accessLog } from './middleware/accessLog.js';
import { authenticate } from './middleware/auth.js';
import { idempotency } from './middleware/idempotency.js';
import { errorHandler } from './middleware/errorHandler.js';
import { AppError } from './lib/errors.js';
import { healthRouter } from './routes/health.js';
import { authRouter, publicAuthRouter } from './routes/auth.js';
import { meRouter } from './routes/me.js';
import { usersRouter } from './routes/users.js';
import { rolesRouter } from './routes/roles.js';
import { orgRouter } from './routes/org.js';

export type AppDeps = { pool: pg.Pool; config: Config };

// Express app factory, kept separate from server.ts so tests can mount it without listening.
export function createApp(deps: AppDeps): express.Express {
  const { pool, config } = deps;
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', 'loopback, uniquelocal');

  app.use(requestId);
  app.use(securityHeaders(config.nodeEnv === 'production'));
  app.use(cors(config.nodeEnv === 'production' ? null : config.corsDevOrigin));
  app.use(accessLog);
  app.use(express.json({ limit: '2mb' }));

  const api = express.Router();
  api.use(healthRouter(pool));
  api.use(publicAuthRouter(deps));
  api.use(authenticate(pool, config.jwtSecret));
  api.use(idempotency(pool));
  api.use(authRouter(deps));
  api.use(meRouter(deps));
  api.use(usersRouter(deps));
  api.use(rolesRouter(deps));
  api.use(orgRouter(deps));
  app.use(API_BASE_PATH, api);

  app.use(API_BASE_PATH, () => {
    throw new AppError('NOT_FOUND', 'Route not found');
  });
  app.use(errorHandler);
  return app;
}
