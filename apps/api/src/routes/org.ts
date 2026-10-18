import { Router } from 'express';
import {
  createFactoryInput, createLineInput, createOperatorInput, createShiftInput, createUnitInput, factorySettingsInput, idParam,
  importOperatorsInput, int, listQuery, object, updateFactoryInput, updateLineInput, updateOperatorInput, updateShiftInput,
  updateUnitInput, type Infer, type ListQuery,
} from '@tqm/shared';
import { requirePermission } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import * as org from '../services/orgService.js';
import type { ServiceDeps } from '../services/context.js';
import { actor, param, query, versionFromQuery } from './helpers.js';

const updateSettingsInput = object({ version: int({ min: 1 }), settings: factorySettingsInput });

export function orgRouter(deps: ServiceDeps): Router {
  const r = Router();
  const manage = requirePermission('org.manage');

  // Reads are open to every signed-in user (filtered by scope); writes need org.manage.
  r.get('/factories', async (req, res) => {
    res.json({ data: await org.listFactories(deps, actor(req)) });
  });
  r.post('/factories', manage, validate({ body: createFactoryInput }), async (req, res) => {
    res.status(201).json({ data: await org.createFactory(deps, actor(req), req.body as Infer<typeof createFactoryInput>) });
  });
  r.get('/factories/:id', validate({ params: idParam }), async (req, res) => {
    res.json({ data: await org.getFactory(deps, actor(req), param(req)) });
  });
  r.patch('/factories/:id', manage, validate({ params: idParam, body: updateFactoryInput }), async (req, res) => {
    res.json({ data: await org.updateFactory(deps, actor(req), param(req), req.body as Infer<typeof updateFactoryInput>) });
  });
  r.patch(
    '/factories/:id/settings',
    requirePermission('settings.manage'),
    validate({ params: idParam, body: updateSettingsInput }),
    async (req, res) => {
      const body = req.body as Infer<typeof updateSettingsInput>;
      res.json({ data: await org.updateSettings(deps, actor(req), param(req), body.version, body.settings) });
    },
  );

  r.get('/units', async (req, res) => {
    res.json({ data: await org.listUnits(deps, actor(req)) });
  });
  r.post('/units', manage, validate({ body: createUnitInput }), async (req, res) => {
    res.status(201).json({ data: await org.createUnit(deps, actor(req), req.body as Infer<typeof createUnitInput>) });
  });
  r.get('/units/:id', validate({ params: idParam }), async (req, res) => {
    res.json({ data: await org.getUnit(deps, actor(req), param(req)) });
  });
  r.patch('/units/:id', manage, validate({ params: idParam, body: updateUnitInput }), async (req, res) => {
    res.json({ data: await org.updateUnit(deps, actor(req), param(req), req.body as Infer<typeof updateUnitInput>) });
  });
  r.delete('/units/:id', manage, validate({ params: idParam }), async (req, res) => {
    await org.deleteUnit(deps, actor(req), param(req), versionFromQuery(req));
    res.json({ data: { ok: true } });
  });

  r.get('/lines', async (req, res) => {
    res.json({ data: await org.listLines(deps, actor(req)) });
  });
  r.post('/lines', manage, validate({ body: createLineInput }), async (req, res) => {
    res.status(201).json({ data: await org.createLine(deps, actor(req), req.body as Infer<typeof createLineInput>) });
  });
  r.get('/lines/:id', validate({ params: idParam }), async (req, res) => {
    res.json({ data: await org.getLine(deps, actor(req), param(req)) });
  });
  r.patch('/lines/:id', manage, validate({ params: idParam, body: updateLineInput }), async (req, res) => {
    res.json({ data: await org.updateLine(deps, actor(req), param(req), req.body as Infer<typeof updateLineInput>) });
  });
  r.delete('/lines/:id', manage, validate({ params: idParam }), async (req, res) => {
    await org.deleteLine(deps, actor(req), param(req), versionFromQuery(req));
    res.json({ data: { ok: true } });
  });

  r.get('/shifts', async (req, res) => {
    res.json({ data: await org.listShifts(deps, actor(req)) });
  });
  r.post('/shifts', manage, validate({ body: createShiftInput }), async (req, res) => {
    res.status(201).json({ data: await org.createShift(deps, actor(req), req.body as Infer<typeof createShiftInput>) });
  });
  r.patch('/shifts/:id', manage, validate({ params: idParam, body: updateShiftInput }), async (req, res) => {
    res.json({ data: await org.updateShift(deps, actor(req), param(req), req.body as Infer<typeof updateShiftInput>) });
  });
  r.delete('/shifts/:id', manage, validate({ params: idParam }), async (req, res) => {
    await org.deleteShift(deps, actor(req), param(req), versionFromQuery(req));
    res.json({ data: { ok: true } });
  });

  r.get('/operators', validate({ query: listQuery }), async (req, res) => {
    const page = await org.listOperators(deps, actor(req), query<ListQuery>(res));
    res.json({ data: page.items, meta: { nextCursor: page.nextCursor, limit: page.limit } });
  });
  r.post('/operators', manage, validate({ body: createOperatorInput }), async (req, res) => {
    res.status(201).json({ data: await org.createOperator(deps, actor(req), req.body as Infer<typeof createOperatorInput>) });
  });
  r.post('/operators/import', manage, validate({ body: importOperatorsInput }), async (req, res) => {
    res.json({ data: await org.importOperators(deps, actor(req), req.body as Infer<typeof importOperatorsInput>) });
  });
  r.get('/operators/:id', validate({ params: idParam }), async (req, res) => {
    res.json({ data: await org.getOperator(deps, actor(req), param(req)) });
  });
  r.patch('/operators/:id', manage, validate({ params: idParam, body: updateOperatorInput }), async (req, res) => {
    res.json({ data: await org.updateOperator(deps, actor(req), param(req), req.body as Infer<typeof updateOperatorInput>) });
  });
  r.delete('/operators/:id', manage, validate({ params: idParam }), async (req, res) => {
    await org.deleteOperator(deps, actor(req), param(req), versionFromQuery(req));
    res.json({ data: { ok: true } });
  });
  return r;
}
