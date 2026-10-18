import { Router } from 'express';
import { updateMeInput, type Infer } from '@tqm/shared';
import { validate } from '../middleware/validate.js';
import { getMe } from '../services/authService.js';
import { bootstrap } from '../services/bootstrapService.js';
import { updateMe } from '../services/usersService.js';
import type { ServiceDeps } from '../services/context.js';
import { actor } from './helpers.js';

export function meRouter(deps: ServiceDeps): Router {
  const r = Router();
  r.get('/me', async (req, res) => {
    res.json({ data: await getMe(deps.pool, actor(req).userId) });
  });
  r.patch('/me', validate({ body: updateMeInput }), async (req, res) => {
    const a = actor(req);
    await updateMe(deps, a, req.body as Infer<typeof updateMeInput>);
    res.json({ data: await getMe(deps.pool, a.userId) });
  });
  r.get('/meta/bootstrap', async (req, res) => {
    res.json({ data: await bootstrap(deps, actor(req)) });
  });
  return r;
}
