import type { RequestHandler } from 'express';
import { logger } from '../lib/logger.js';

// One JSON line per request (SPEC §11). Bodies are never logged.
export const accessLog: RequestHandler = (req, res, next) => {
  const start = process.hrtime.bigint();
  res.on('finish', () => {
    const ms = Number(process.hrtime.bigint() - start) / 1e6;
    logger.info('request', {
      requestId: req.ctx.requestId,
      userId: req.ctx.auth?.userId ?? null,
      method: req.method,
      path: req.path,
      status: res.statusCode,
      ms: Math.round(ms * 10) / 10,
    });
  });
  next();
};
