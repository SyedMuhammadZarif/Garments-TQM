import type { Request, Response } from 'express';
import { AppError } from '../lib/errors.js';
import type { Actor } from '../services/context.js';

export function actor(req: Request): Actor {
  const auth = req.ctx.auth;
  if (!auth) throw new AppError('UNAUTHENTICATED', 'Please log in');
  return { ...auth, requestId: req.ctx.requestId };
}

/** Typed access to the query parsed by validate(). */
export function query<T>(res: Response): T {
  return res.locals.query as T;
}

export function param(req: Request, name = 'id'): string {
  const value = req.params[name];
  if (typeof value !== 'string') throw new AppError('NOT_FOUND', 'Not found');
  return value;
}

/** DELETE takes the edited version as ?version= (optimistic concurrency without a body). */
export function versionFromQuery(req: Request): number {
  const v = Number(req.query.version);
  if (!Number.isInteger(v) || v < 1) {
    throw new AppError('VALIDATION_FAILED', 'version is required', { issues: [{ path: 'version', code: 'required', message: 'Required' }] });
  }
  return v;
}
