import { Router } from 'express';
import { createRoleInput, idParam, setRolePermissionsInput, updateRoleInput, type Infer } from '@tqm/shared';
import { requirePermission } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import * as roles from '../services/rolesService.js';
import type { ServiceDeps } from '../services/context.js';
import { actor, param } from './helpers.js';

export function rolesRouter(deps: ServiceDeps): Router {
  const r = Router();
  // Reading roles is needed by anyone who assigns them to users.
  r.get('/roles', async (req, res, next) => {
    const a = actor(req);
    if (!a.isSuperAdmin && !a.permissions.has('roles.manage') && !a.permissions.has('users.manage')) {
      return requirePermission('roles.manage')(req, res, next);
    }
    res.json({ data: await roles.listRoles(deps) });
  });
  r.get('/permissions', requirePermission('roles.manage'), (_req, res) => {
    res.json({ data: roles.listPermissions() });
  });
  r.post('/roles', requirePermission('roles.manage'), validate({ body: createRoleInput }), async (req, res) => {
    res.status(201).json({ data: await roles.createRole(deps, actor(req), req.body as Infer<typeof createRoleInput>) });
  });
  r.patch('/roles/:id', requirePermission('roles.manage'), validate({ params: idParam, body: updateRoleInput }), async (req, res) => {
    res.json({ data: await roles.updateRole(deps, actor(req), param(req), req.body as Infer<typeof updateRoleInput>) });
  });
  r.put(
    '/roles/:id/permissions',
    requirePermission('roles.manage'),
    validate({ params: idParam, body: setRolePermissionsInput }),
    async (req, res) => {
      const body = req.body as Infer<typeof setRolePermissionsInput>;
      res.json({ data: await roles.setPermissions(deps, actor(req), param(req), body.permissions) });
    },
  );
  return r;
}
