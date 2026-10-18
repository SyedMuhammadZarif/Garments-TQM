import { Router } from 'express';
import {
  createUserInput, idParam, listQuery, resetPasswordInput, setUserRolesInput, setUserScopesInput, updateUserInput, type Infer,
  type ListQuery,
} from '@tqm/shared';
import { requirePermission } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import * as users from '../services/usersService.js';
import type { ServiceDeps } from '../services/context.js';
import { actor, param, query, versionFromQuery } from './helpers.js';

export function usersRouter(deps: ServiceDeps): Router {
  const r = Router();
  r.use('/users', requirePermission('users.manage'));

  r.get('/users', validate({ query: listQuery }), async (req, res) => {
    const page = await users.listUsers(deps, actor(req), query<ListQuery>(res));
    res.json({ data: page.items, meta: { nextCursor: page.nextCursor, limit: page.limit } });
  });
  r.post('/users', validate({ body: createUserInput }), async (req, res) => {
    res.status(201).json({ data: await users.createUser(deps, actor(req), req.body as Infer<typeof createUserInput>) });
  });
  r.get('/users/:id', validate({ params: idParam }), async (req, res) => {
    res.json({ data: await users.getUser(deps, actor(req), param(req)) });
  });
  r.patch('/users/:id', validate({ params: idParam, body: updateUserInput }), async (req, res) => {
    res.json({ data: await users.updateUser(deps, actor(req), param(req), req.body as Infer<typeof updateUserInput>) });
  });
  r.post('/users/:id/deactivate', validate({ params: idParam }), async (req, res) => {
    res.json({ data: await users.deactivateUser(deps, actor(req), param(req), versionFromQuery(req)) });
  });
  r.post('/users/:id/reset-password', validate({ params: idParam, body: resetPasswordInput }), async (req, res) => {
    const body = req.body as Infer<typeof resetPasswordInput>;
    res.json({ data: await users.resetPassword(deps, actor(req), param(req), body.temporaryPassword) });
  });
  r.put('/users/:id/roles', validate({ params: idParam, body: setUserRolesInput }), async (req, res) => {
    res.json({ data: await users.setRoles(deps, actor(req), param(req), (req.body as Infer<typeof setUserRolesInput>).roleIds) });
  });
  r.put('/users/:id/scopes', validate({ params: idParam, body: setUserScopesInput }), async (req, res) => {
    res.json({ data: await users.setScopes(deps, actor(req), param(req), (req.body as Infer<typeof setUserScopesInput>).scopes) });
  });
  return r;
}
