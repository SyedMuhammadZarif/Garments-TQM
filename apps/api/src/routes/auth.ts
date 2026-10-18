import { Router } from 'express';
import { changePasswordInput, loginInput, logoutInput, refreshInput, type Infer } from '@tqm/shared';
import { validate } from '../middleware/validate.js';
import * as authService from '../services/authService.js';
import type { ServiceDeps } from '../services/context.js';
import { actor } from './helpers.js';

/** Routes that work without an access token. */
export function publicAuthRouter(deps: ServiceDeps): Router {
  const r = Router();

  r.post('/auth/login', validate({ body: loginInput }), async (req, res) => {
    const body = req.body as Infer<typeof loginInput>;
    const result = await authService.login(deps, body, {
      ip: req.ip ?? null,
      userAgent: req.get('user-agent') ?? null,
      requestId: req.ctx.requestId,
    });
    res.json({ data: result });
  });

  r.post('/auth/refresh', validate({ body: refreshInput }), async (req, res) => {
    const body = req.body as Infer<typeof refreshInput>;
    res.json({ data: await authService.refresh(deps, body, { userAgent: req.get('user-agent') ?? null, requestId: req.ctx.requestId }) });
  });

  r.post('/auth/logout', validate({ body: logoutInput }), async (req, res) => {
    await authService.logout(deps, (req.body as Infer<typeof logoutInput>).refreshToken, req.ctx.requestId);
    res.json({ data: { ok: true } });
  });

  return r;
}

export function authRouter(deps: ServiceDeps): Router {
  const r = Router();
  r.post('/auth/change-password', validate({ body: changePasswordInput }), async (req, res) => {
    const a = actor(req);
    await authService.changePassword(deps, a.userId, req.body as Infer<typeof changePasswordInput>, a.requestId);
    res.json({ data: await authService.getMe(deps.pool, a.userId) });
  });
  return r;
}
