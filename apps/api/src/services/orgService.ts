import {
  DEFAULT_FACTORY_SETTINGS, parseCsvRecords, type FactorySettings, type FactoryWithSettingsDto, type LineDto, type LineType,
  type OperatorDto, type OperatorImportResult, type OperatorImportRow, type ShiftDto, type UnitDto,
} from '@tqm/shared';
import { withTx } from '../db/tx.js';
import { AppError, forbidden } from '../lib/errors.js';
import { decodeCursor, encodeCursor, pageOf } from '../lib/pagination.js';
import { hasFactoryWideScope, inScope } from '../lib/scope.js';
import * as orgRepo from '../repos/orgRepo.js';
import { outOfScope, txCtx, type Actor, type ServiceDeps } from './context.js';

// Stored settings are validated in full on every write, so a shallow merge over defaults is enough to fill
// keys added in later versions.
export function mergeSettings(stored: unknown): FactorySettings {
  const obj = stored && typeof stored === 'object' ? (stored as Partial<FactorySettings>) : {};
  return { ...DEFAULT_FACTORY_SETTINGS, ...obj };
}

function requireFactoryWide(actor: Actor, factoryId: string): void {
  if (!hasFactoryWideScope(actor, factoryId)) throw forbidden('You need access to the whole factory to change this');
}

// ---- factories --------------------------------------------------------------------------------------------

export async function listFactories(deps: ServiceDeps, actor: Actor): Promise<FactoryWithSettingsDto[]> {
  const factories = await orgRepo.listFactories(deps.pool, actor);
  const settings = await orgRepo.getFactorySettings(deps.pool, factories.map((f) => f.id));
  return factories.map((f) => ({ ...f, settings: mergeSettings(settings.get(f.id)) }));
}

export async function getFactory(deps: ServiceDeps, actor: Actor, id: string): Promise<FactoryWithSettingsDto> {
  const f = await orgRepo.findFactory(deps.pool, id);
  if (!f || !inScope(actor, f.id)) throw outOfScope('Factory');
  const settings = await orgRepo.getFactorySettings(deps.pool, [id]);
  return { ...f, settings: mergeSettings(settings.get(id)) };
}

export async function createFactory(
  deps: ServiceDeps,
  actor: Actor,
  input: { id: string; code: string; name: string; legalName?: string | null; timezone?: string; address?: string | null },
): Promise<FactoryWithSettingsDto> {
  if (!actor.isSuperAdmin) throw forbidden('Only a super admin can add factories');
  await withTx(deps.pool, txCtx(actor), (tx) =>
    orgRepo.insertFactory(tx, {
      id: input.id,
      code: input.code,
      name: input.name,
      legalName: input.legalName ?? null,
      timezone: input.timezone ?? 'Asia/Dhaka',
      address: input.address ?? null,
      settings: DEFAULT_FACTORY_SETTINGS,
      userId: actor.userId,
    }),
  );
  return getFactory(deps, actor, input.id);
}

export async function updateFactory(
  deps: ServiceDeps,
  actor: Actor,
  id: string,
  input: { version: number; name?: string; legalName?: string | null; timezone?: string; address?: string | null },
): Promise<FactoryWithSettingsDto> {
  await getFactory(deps, actor, id);
  requireFactoryWide(actor, id);
  const { version, ...patch } = input;
  await withTx(deps.pool, txCtx(actor), (tx) => orgRepo.updateFactory(tx, id, version, actor.userId, patch));
  return getFactory(deps, actor, id);
}

export async function updateSettings(
  deps: ServiceDeps,
  actor: Actor,
  id: string,
  version: number,
  settings: FactorySettings,
): Promise<FactoryWithSettingsDto> {
  await getFactory(deps, actor, id);
  requireFactoryWide(actor, id);
  await withTx(deps.pool, txCtx(actor), (tx) =>
    orgRepo.updateFactory(tx, id, version, actor.userId, { settingsJson: JSON.stringify(settings) }),
  );
  return getFactory(deps, actor, id);
}

// ---- units ------------------------------------------------------------------------------------------------

export const listUnits = (deps: ServiceDeps, actor: Actor): Promise<UnitDto[]> => orgRepo.listUnits(deps.pool, actor);

async function visibleUnit(deps: ServiceDeps, actor: Actor, id: string): Promise<UnitDto> {
  const unit = await orgRepo.findUnit(deps.pool, id);
  if (!unit || !inScope(actor, unit.factoryId, unit.id)) throw outOfScope('Unit');
  return unit;
}

export const getUnit = visibleUnit;

export async function createUnit(
  deps: ServiceDeps,
  actor: Actor,
  input: { id: string; factoryId: string; code: string; name: string; address?: string | null },
): Promise<UnitDto> {
  if (!(await orgRepo.findFactory(deps.pool, input.factoryId)) || !inScope(actor, input.factoryId)) throw outOfScope('Factory');
  requireFactoryWide(actor, input.factoryId);
  return withTx(deps.pool, txCtx(actor), (tx) => orgRepo.insertUnit(tx, { ...input, address: input.address ?? null, userId: actor.userId }));
}

export async function updateUnit(
  deps: ServiceDeps,
  actor: Actor,
  id: string,
  input: { version: number; code?: string; name?: string; address?: string | null },
): Promise<UnitDto> {
  const unit = await visibleUnit(deps, actor, id);
  requireFactoryWide(actor, unit.factoryId);
  const { version, ...patch } = input;
  return withTx(deps.pool, txCtx(actor), (tx) => orgRepo.updateUnit(tx, id, version, actor.userId, patch));
}

export async function deleteUnit(deps: ServiceDeps, actor: Actor, id: string, version: number): Promise<void> {
  const unit = await visibleUnit(deps, actor, id);
  requireFactoryWide(actor, unit.factoryId);
  const lines = (await orgRepo.listLines(deps.pool, actor)).filter((l) => l.unitId === id);
  if (lines.length > 0) throw new AppError('INVALID_TRANSITION', 'Remove or move the lines of this unit first');
  await withTx(deps.pool, txCtx(actor), (tx) => orgRepo.deleteUnit(tx, id, version, actor.userId));
}

// ---- lines ------------------------------------------------------------------------------------------------

export const listLines = (deps: ServiceDeps, actor: Actor): Promise<LineDto[]> => orgRepo.listLines(deps.pool, actor);

async function visibleLine(deps: ServiceDeps, actor: Actor, id: string): Promise<LineDto> {
  const line = await orgRepo.findLine(deps.pool, id);
  if (!line || !inScope(actor, line.factoryId, line.unitId)) throw outOfScope('Line');
  return line;
}

export const getLine = visibleLine;

export async function createLine(
  deps: ServiceDeps,
  actor: Actor,
  input: { id: string; unitId: string; code: string; name: string; lineType: LineType; sortOrder?: number; isActive?: boolean },
): Promise<LineDto> {
  const unit = await visibleUnit(deps, actor, input.unitId);
  return withTx(deps.pool, txCtx(actor), (tx) =>
    orgRepo.insertLine(tx, {
      ...input,
      factoryId: unit.factoryId,
      sortOrder: input.sortOrder ?? 0,
      isActive: input.isActive ?? true,
      userId: actor.userId,
    }),
  );
}

export async function updateLine(
  deps: ServiceDeps,
  actor: Actor,
  id: string,
  input: { version: number; code?: string; name?: string; lineType?: LineType; sortOrder?: number; isActive?: boolean },
): Promise<LineDto> {
  await visibleLine(deps, actor, id);
  const { version, ...patch } = input;
  return withTx(deps.pool, txCtx(actor), (tx) => orgRepo.updateLine(tx, id, version, actor.userId, patch));
}

export async function deleteLine(deps: ServiceDeps, actor: Actor, id: string, version: number): Promise<void> {
  await visibleLine(deps, actor, id);
  await withTx(deps.pool, txCtx(actor), (tx) => orgRepo.deleteLine(tx, id, version, actor.userId));
}

// ---- shifts -----------------------------------------------------------------------------------------------

export const listShifts = (deps: ServiceDeps, actor: Actor): Promise<ShiftDto[]> => orgRepo.listShifts(deps.pool, actor);

async function visibleShift(deps: ServiceDeps, actor: Actor, id: string): Promise<ShiftDto> {
  const shift = await orgRepo.findShift(deps.pool, id);
  if (!shift || !inScope(actor, shift.factoryId)) throw outOfScope('Shift');
  return shift;
}

export async function createShift(
  deps: ServiceDeps,
  actor: Actor,
  input: { id: string; factoryId: string; name: string; startTime: string; endTime: string },
): Promise<ShiftDto> {
  if (!inScope(actor, input.factoryId)) throw outOfScope('Factory');
  requireFactoryWide(actor, input.factoryId);
  if (input.startTime === input.endTime) throw new AppError('VALIDATION_FAILED', 'Start and end time must differ', { issues: [{ path: 'endTime', code: 'same', message: 'Must differ from start time' }] });
  return withTx(deps.pool, txCtx(actor), (tx) => orgRepo.insertShift(tx, { ...input, userId: actor.userId }));
}

export async function updateShift(
  deps: ServiceDeps,
  actor: Actor,
  id: string,
  input: { version: number; name?: string; startTime?: string; endTime?: string },
): Promise<ShiftDto> {
  const shift = await visibleShift(deps, actor, id);
  requireFactoryWide(actor, shift.factoryId);
  const { version, ...patch } = input;
  return withTx(deps.pool, txCtx(actor), (tx) => orgRepo.updateShift(tx, id, version, actor.userId, patch));
}

export async function deleteShift(deps: ServiceDeps, actor: Actor, id: string, version: number): Promise<void> {
  const shift = await visibleShift(deps, actor, id);
  requireFactoryWide(actor, shift.factoryId);
  await withTx(deps.pool, txCtx(actor), (tx) => orgRepo.deleteShift(tx, id, version, actor.userId));
}

// ---- operators --------------------------------------------------------------------------------------------

export async function listOperators(
  deps: ServiceDeps,
  actor: Actor,
  q: { q?: string; cursor?: string; limit?: number; factoryId?: string; unitId?: string; lineId?: string; active?: boolean },
): Promise<{ items: OperatorDto[]; nextCursor: string | null; limit: number }> {
  const limit = q.limit ?? 50;
  const after = q.cursor ? decodeCursor(q.cursor) : null;
  const rows = await orgRepo.listOperators(deps.pool, actor, {
    factoryId: q.factoryId ?? null,
    unitId: q.unitId ?? null,
    lineId: q.lineId ?? null,
    active: q.active ?? null,
    q: q.q ?? null,
    afterCode: after?.sortValue ?? null,
    afterId: after?.id ?? null,
    limit,
  });
  const page = pageOf(rows, limit, (r) => encodeCursor(r.code, r.id));
  return { ...page, limit };
}

export async function getOperator(deps: ServiceDeps, actor: Actor, id: string): Promise<OperatorDto> {
  const op = await orgRepo.findOperator(deps.pool, id);
  if (!op || !inScope(actor, op.factoryId, op.unitId)) throw outOfScope('Operator');
  return op;
}

async function checkLineInUnit(deps: ServiceDeps, lineId: string | null | undefined, unitId: string): Promise<void> {
  if (!lineId) return;
  const line = await orgRepo.findLine(deps.pool, lineId);
  if (!line || line.unitId !== unitId) {
    throw new AppError('VALIDATION_FAILED', 'Line does not belong to the unit', {
      issues: [{ path: 'lineId', code: 'mismatch', message: 'Line does not belong to the unit' }],
    });
  }
}

export async function createOperator(
  deps: ServiceDeps,
  actor: Actor,
  input: { id: string; unitId: string; lineId?: string | null; code: string; name: string; skillGrade?: string | null; isActive?: boolean },
): Promise<OperatorDto> {
  const unit = await visibleUnit(deps, actor, input.unitId);
  await checkLineInUnit(deps, input.lineId, unit.id);
  return withTx(deps.pool, txCtx(actor), (tx) =>
    orgRepo.insertOperator(tx, {
      id: input.id,
      factoryId: unit.factoryId,
      unitId: unit.id,
      lineId: input.lineId ?? null,
      code: input.code,
      name: input.name,
      skillGrade: input.skillGrade ?? null,
      isActive: input.isActive ?? true,
      userId: actor.userId,
    }),
  );
}

export async function updateOperator(
  deps: ServiceDeps,
  actor: Actor,
  id: string,
  input: { version: number; unitId?: string; lineId?: string | null; code?: string; name?: string; skillGrade?: string | null; isActive?: boolean },
): Promise<OperatorDto> {
  const op = await getOperator(deps, actor, id);
  const unitId = input.unitId ?? op.unitId;
  if (input.unitId) {
    const unit = await visibleUnit(deps, actor, input.unitId);
    if (unit.factoryId !== op.factoryId) throw new AppError('VALIDATION_FAILED', 'Operators cannot move between factories');
  }
  const { version, ...patch } = input;
  // Moving to another unit without naming a line clears the old line, which belonged to the old unit.
  if (unitId !== op.unitId && input.lineId === undefined) patch.lineId = null;
  await checkLineInUnit(deps, patch.lineId, unitId);
  return withTx(deps.pool, txCtx(actor), (tx) => orgRepo.updateOperator(tx, id, version, actor.userId, patch));
}

export async function deleteOperator(deps: ServiceDeps, actor: Actor, id: string, version: number): Promise<void> {
  await getOperator(deps, actor, id);
  await withTx(deps.pool, txCtx(actor), (tx) => orgRepo.deleteOperator(tx, id, version, actor.userId));
}

/**
 * CSV import (columns: code, name, unit_code, line_code, skill_grade, active). Rows are matched by operator
 * code within the factory: existing codes are updated, new ones created. All-or-nothing: if any row has an
 * error nothing is written and the full row report is returned.
 */
export async function importOperators(
  deps: ServiceDeps,
  actor: Actor,
  input: { factoryId: string; csv: string; dryRun: boolean },
): Promise<OperatorImportResult> {
  if (!inScope(actor, input.factoryId)) throw outOfScope('Factory');
  const { headers, records } = parseCsvRecords(input.csv);
  for (const required of ['code', 'name', 'unit_code']) {
    if (!headers.includes(required)) {
      throw new AppError('VALIDATION_FAILED', `Missing column "${required}". Expected: code, name, unit_code, line_code, skill_grade, active`);
    }
  }
  if (records.length > 5000) throw new AppError('PAYLOAD_TOO_LARGE', 'Import at most 5,000 operators at a time');

  const units = (await orgRepo.listUnits(deps.pool, actor)).filter((u) => u.factoryId === input.factoryId);
  const lines = (await orgRepo.listLines(deps.pool, actor)).filter((l) => l.factoryId === input.factoryId);
  const existing = await orgRepo.operatorIdsByCode(deps.pool, input.factoryId, records.map((r) => r.code ?? ''));
  const seen = new Set<string>();

  const rows: (OperatorImportRow & { unitId: string | null; lineId: string | null; isActive: boolean })[] = records.map((r, i) => {
    const errors: string[] = [];
    const code = r.code ?? '';
    const name = r.name ?? '';
    const unitCode = r.unit_code ?? '';
    const lineCode = r.line_code ? r.line_code : null;
    const skillGrade = r.skill_grade ? r.skill_grade : null;
    const activeRaw = (r.active ?? '').toLowerCase();
    if (!/^[A-Za-z0-9][A-Za-z0-9_.-]{0,29}$/.test(code)) errors.push('Code is missing or invalid');
    else if (seen.has(code)) errors.push('Code appears twice in the file');
    seen.add(code);
    if (!name || name.length > 120) errors.push('Name is missing or too long');
    const unit = units.find((u) => u.code.toLowerCase() === unitCode.toLowerCase());
    if (!unit) errors.push(`Unit "${unitCode}" not found`);
    const line = lineCode && unit ? lines.find((l) => l.unitId === unit.id && l.code.toLowerCase() === lineCode.toLowerCase()) : undefined;
    if (lineCode && unit && !line) errors.push(`Line "${lineCode}" not found in unit ${unit.code}`);
    if (skillGrade && skillGrade.length > 20) errors.push('Skill grade is too long');
    if (activeRaw && !['yes', 'no', 'true', 'false', '1', '0', 'y', 'n'].includes(activeRaw)) errors.push('Active must be yes or no');
    return {
      row: i + 2, // +1 for the header, +1 for 1-based numbering as shown in spreadsheets
      code,
      name,
      unitCode,
      lineCode,
      skillGrade,
      action: errors.length ? 'error' : existing.has(code) ? 'update' : 'create',
      errors,
      unitId: unit?.id ?? null,
      lineId: line?.id ?? null,
      isActive: !['no', 'false', '0', 'n'].includes(activeRaw),
    };
  });

  const report = rows.map(({ unitId: _u, lineId: _l, isActive: _a, ...r }) => r);
  const created = rows.filter((r) => r.action === 'create').length;
  const updated = rows.filter((r) => r.action === 'update').length;
  if (input.dryRun || rows.some((r) => r.action === 'error')) return { rows: report, created, updated, committed: false };

  await withTx(deps.pool, txCtx(actor), async (tx) => {
    for (const r of rows) {
      const match = existing.get(r.code);
      if (match) {
        await orgRepo.updateOperator(tx, match.id, match.version, actor.userId, {
          name: r.name,
          unitId: r.unitId,
          lineId: r.lineId,
          skillGrade: r.skillGrade,
          isActive: r.isActive,
        });
      } else {
        await orgRepo.insertOperator(tx, {
          id: crypto.randomUUID(),
          factoryId: input.factoryId,
          unitId: r.unitId!,
          lineId: r.lineId,
          code: r.code,
          name: r.name,
          skillGrade: r.skillGrade,
          isActive: r.isActive,
          userId: actor.userId,
        });
      }
    }
  });
  return { rows: report, created, updated, committed: true };
}

