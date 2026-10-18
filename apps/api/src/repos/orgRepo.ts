import type { FactoryDto, LineDto, OperatorDto, ShiftDto, UnitDto } from '@tqm/shared';
import type { Db } from '../db/tx.js';
import { softDelete, updateVersioned } from '../lib/sql.js';
import { scopeClause, type ScopeSubject } from '../lib/scope.js';

// Rows are selected straight into DTO shape (camelCase aliases).
const FACTORY = `id, code, name, legal_name as "legalName", timezone, address, version`;
const UNIT = `id, factory_id as "factoryId", code, name, address, version`;
const LINE = `id, factory_id as "factoryId", unit_id as "unitId", code, name, line_type as "lineType",
  sort_order as "sortOrder", is_active as "isActive", version`;
const SHIFT = `id, factory_id as "factoryId", name, to_char(start_time, 'HH24:MI') as "startTime",
  to_char(end_time, 'HH24:MI') as "endTime", crosses_midnight as "crossesMidnight", version`;
const OPERATOR = `id, factory_id as "factoryId", unit_id as "unitId", line_id as "lineId", code, name,
  skill_grade as "skillGrade", is_active as "isActive", version`;

// ---- factories --------------------------------------------------------------------------------------------

export async function listFactories(db: Db, subject: ScopeSubject): Promise<FactoryDto[]> {
  const params: unknown[] = [];
  const scope = scopeClause(subject, { factory: 'id' }, params);
  const { rows } = await db.query<FactoryDto>(`select ${FACTORY} from factories where deleted_at is null and ${scope} order by name`, params);
  return rows;
}

export async function findFactory(db: Db, id: string): Promise<FactoryDto | null> {
  const { rows } = await db.query<FactoryDto>(`select ${FACTORY} from factories where id = $1 and deleted_at is null`, [id]);
  return rows[0] ?? null;
}

export async function getFactorySettings(db: Db, ids: string[]): Promise<Map<string, unknown>> {
  const { rows } = await db.query<{ id: string; settings: unknown }>('select id, settings from factories where id = any($1)', [ids]);
  return new Map(rows.map((r) => [r.id, r.settings]));
}

export async function insertFactory(
  db: Db,
  f: { id: string; code: string; name: string; legalName: string | null; timezone: string; address: string | null; settings: unknown; userId: string },
): Promise<void> {
  await db.query(
    `insert into factories (id, code, name, legal_name, timezone, address, settings, created_by, updated_by)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $8)`,
    [f.id, f.code, f.name, f.legalName, f.timezone, f.address, JSON.stringify(f.settings), f.userId],
  );
}

export function updateFactory(db: Db, id: string, version: number, userId: string, patch: Record<string, unknown>): Promise<FactoryDto> {
  return updateVersioned<FactoryDto>(db, 'factories', {
    id,
    version,
    userId,
    patch,
    returning: FACTORY,
    columns: { name: 'name', legalName: 'legal_name', timezone: 'timezone', address: 'address', settingsJson: 'settings' },
  });
}

// ---- units ------------------------------------------------------------------------------------------------

export async function listUnits(db: Db, subject: ScopeSubject): Promise<UnitDto[]> {
  const params: unknown[] = [];
  const scope = scopeClause(subject, { factory: 'factory_id', unit: 'id' }, params);
  const { rows } = await db.query<UnitDto>(`select ${UNIT} from units where deleted_at is null and ${scope} order by code`, params);
  return rows;
}

export async function findUnit(db: Db, id: string): Promise<UnitDto | null> {
  const { rows } = await db.query<UnitDto>(`select ${UNIT} from units where id = $1 and deleted_at is null`, [id]);
  return rows[0] ?? null;
}

export async function insertUnit(db: Db, u: { id: string; factoryId: string; code: string; name: string; address: string | null; userId: string }): Promise<UnitDto> {
  const { rows } = await db.query<UnitDto>(
    `insert into units (id, factory_id, code, name, address, created_by, updated_by) values ($1, $2, $3, $4, $5, $6, $6)
     returning ${UNIT}`,
    [u.id, u.factoryId, u.code, u.name, u.address, u.userId],
  );
  return rows[0]!;
}

export function updateUnit(db: Db, id: string, version: number, userId: string, patch: Record<string, unknown>): Promise<UnitDto> {
  return updateVersioned<UnitDto>(db, 'units', { id, version, userId, patch, returning: UNIT, columns: { code: 'code', name: 'name', address: 'address' } });
}

export const deleteUnit = (db: Db, id: string, version: number, userId: string) => softDelete(db, 'units', id, version, userId);

// ---- lines ------------------------------------------------------------------------------------------------

export async function listLines(db: Db, subject: ScopeSubject): Promise<LineDto[]> {
  const params: unknown[] = [];
  const scope = scopeClause(subject, { factory: 'factory_id', unit: 'unit_id' }, params);
  const { rows } = await db.query<LineDto>(
    `select ${LINE} from lines where deleted_at is null and ${scope} order by unit_id, sort_order, code`,
    params,
  );
  return rows;
}

export async function findLine(db: Db, id: string): Promise<LineDto | null> {
  const { rows } = await db.query<LineDto>(`select ${LINE} from lines where id = $1 and deleted_at is null`, [id]);
  return rows[0] ?? null;
}

export async function insertLine(
  db: Db,
  l: { id: string; factoryId: string; unitId: string; code: string; name: string; lineType: string; sortOrder: number; isActive: boolean; userId: string },
): Promise<LineDto> {
  const { rows } = await db.query<LineDto>(
    `insert into lines (id, factory_id, unit_id, code, name, line_type, sort_order, is_active, created_by, updated_by)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $9) returning ${LINE}`,
    [l.id, l.factoryId, l.unitId, l.code, l.name, l.lineType, l.sortOrder, l.isActive, l.userId],
  );
  return rows[0]!;
}

export function updateLine(db: Db, id: string, version: number, userId: string, patch: Record<string, unknown>): Promise<LineDto> {
  return updateVersioned<LineDto>(db, 'lines', {
    id,
    version,
    userId,
    patch,
    returning: LINE,
    columns: { code: 'code', name: 'name', lineType: 'line_type', sortOrder: 'sort_order', isActive: 'is_active' },
  });
}

export const deleteLine = (db: Db, id: string, version: number, userId: string) => softDelete(db, 'lines', id, version, userId);

// ---- shifts -----------------------------------------------------------------------------------------------

export async function listShifts(db: Db, subject: ScopeSubject): Promise<ShiftDto[]> {
  const params: unknown[] = [];
  const scope = scopeClause(subject, { factory: 'factory_id' }, params);
  const { rows } = await db.query<ShiftDto>(`select ${SHIFT} from shifts where deleted_at is null and ${scope} order by start_time`, params);
  return rows;
}

export async function findShift(db: Db, id: string): Promise<ShiftDto | null> {
  const { rows } = await db.query<ShiftDto>(`select ${SHIFT} from shifts where id = $1 and deleted_at is null`, [id]);
  return rows[0] ?? null;
}

export async function insertShift(
  db: Db,
  s: { id: string; factoryId: string; name: string; startTime: string; endTime: string; userId: string },
): Promise<ShiftDto> {
  // crosses_midnight is derived, never entered: a 22:00–06:00 night shift crosses midnight.
  const { rows } = await db.query<ShiftDto>(
    `insert into shifts (id, factory_id, name, start_time, end_time, crosses_midnight, created_by, updated_by)
     values ($1, $2, $3, $4::time, $5::time, $5::time <= $4::time, $6, $6) returning ${SHIFT}`,
    [s.id, s.factoryId, s.name, s.startTime, s.endTime, s.userId],
  );
  return rows[0]!;
}

export async function updateShift(db: Db, id: string, version: number, userId: string, patch: Record<string, unknown>): Promise<ShiftDto> {
  await updateVersioned(db, 'shifts', { id, version, userId, patch, returning: 'id', columns: { name: 'name', startTime: 'start_time', endTime: 'end_time' } });
  const { rows } = await db.query<ShiftDto>(
    `update shifts set crosses_midnight = end_time <= start_time where id = $1 returning ${SHIFT}`,
    [id],
  );
  return rows[0]!;
}

export const deleteShift = (db: Db, id: string, version: number, userId: string) => softDelete(db, 'shifts', id, version, userId);

// ---- operators --------------------------------------------------------------------------------------------

export async function listOperators(
  db: Db,
  subject: ScopeSubject,
  opts: {
    factoryId: string | null;
    unitId: string | null;
    lineId: string | null;
    active: boolean | null;
    q: string | null;
    afterCode: string | null;
    afterId: string | null;
    limit: number;
  },
): Promise<OperatorDto[]> {
  const params: unknown[] = [opts.factoryId, opts.unitId, opts.lineId, opts.active, opts.q, opts.afterCode, opts.afterId, opts.limit + 1];
  const scope = scopeClause(subject, { factory: 'factory_id', unit: 'unit_id' }, params);
  const { rows } = await db.query<OperatorDto>(
    `select ${OPERATOR} from operators
      where deleted_at is null and ${scope}
        and ($1::uuid is null or factory_id = $1)
        and ($2::uuid is null or unit_id = $2)
        and ($3::uuid is null or line_id = $3)
        and ($4::boolean is null or is_active = $4)
        and ($5::text is null or code ilike '%' || $5 || '%' or name ilike '%' || $5 || '%')
        and ($6::text is null or (code, id) > ($6, $7::uuid))
      order by code, id
      limit $8`,
    params,
  );
  return rows;
}

export async function findOperator(db: Db, id: string): Promise<OperatorDto | null> {
  const { rows } = await db.query<OperatorDto>(`select ${OPERATOR} from operators where id = $1 and deleted_at is null`, [id]);
  return rows[0] ?? null;
}

export async function operatorIdsByCode(db: Db, factoryId: string, codes: string[]): Promise<Map<string, { id: string; version: number }>> {
  const { rows } = await db.query<{ id: string; code: string; version: number }>(
    'select id, code, version from operators where factory_id = $1 and code = any($2) and deleted_at is null',
    [factoryId, codes],
  );
  return new Map(rows.map((r) => [r.code, { id: r.id, version: r.version }]));
}

export async function insertOperator(
  db: Db,
  o: { id: string; factoryId: string; unitId: string; lineId: string | null; code: string; name: string; skillGrade: string | null; isActive: boolean; userId: string },
): Promise<OperatorDto> {
  const { rows } = await db.query<OperatorDto>(
    `insert into operators (id, factory_id, unit_id, line_id, code, name, skill_grade, is_active, created_by, updated_by)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $9) returning ${OPERATOR}`,
    [o.id, o.factoryId, o.unitId, o.lineId, o.code, o.name, o.skillGrade, o.isActive, o.userId],
  );
  return rows[0]!;
}

export function updateOperator(db: Db, id: string, version: number, userId: string, patch: Record<string, unknown>): Promise<OperatorDto> {
  return updateVersioned<OperatorDto>(db, 'operators', {
    id,
    version,
    userId,
    patch,
    returning: OPERATOR,
    columns: { unitId: 'unit_id', lineId: 'line_id', code: 'code', name: 'name', skillGrade: 'skill_grade', isActive: 'is_active' },
  });
}

export const deleteOperator = (db: Db, id: string, version: number, userId: string) => softDelete(db, 'operators', id, version, userId);
