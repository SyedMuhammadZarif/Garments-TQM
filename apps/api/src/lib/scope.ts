import type { UserScope } from '@tqm/shared';

// Data scope filter (SPEC §5.4). Returns a SQL fragment; parameters are appended to `params` so the
// fragment can be combined with any query. This is the documented exception to "no ${} in SQL":
// only column names (from code, never user input) are interpolated.
export type ScopeSubject = { isSuperAdmin: boolean; scopes: readonly UserScope[] };
export type ScopeColumns = { factory: string; unit?: string };

const COLUMN_RE = /^[a-z_][a-z0-9_]*(\.[a-z_][a-z0-9_]*)?$/;

export function scopeClause(subject: ScopeSubject, cols: ScopeColumns, params: unknown[]): string {
  for (const c of [cols.factory, cols.unit]) {
    if (c !== undefined && !COLUMN_RE.test(c)) throw new Error(`scopeClause: bad column ${c}`);
  }
  if (subject.isSuperAdmin) return 'true';
  if (subject.scopes.length === 0) return 'false';
  params.push(subject.scopes.map((s) => s.factoryId));
  const f = params.length;
  params.push(subject.scopes.map((s) => s.unitId));
  const u = params.length;
  // A scope with unit_id null covers the whole factory. Rows without a unit column (e.g. shifts) only
  // need a factory match.
  const unitCond = cols.unit ? `and (s.u is null or s.u = ${cols.unit})` : '';
  return `exists (select 1 from unnest($${f}::uuid[], $${u}::uuid[]) as s(f, u) where s.f = ${cols.factory} ${unitCond})`;
}

/**
 * True if a row of factory/unit is visible to the subject. Same rule as scopeClause: a factory-wide scope
 * covers every unit; a unit scope covers only that unit; rows without a unit need only a factory match.
 */
export function inScope(subject: ScopeSubject, factoryId: string, unitId: string | null = null): boolean {
  if (subject.isSuperAdmin) return true;
  return subject.scopes.some(
    (s) => s.factoryId === factoryId && (s.unitId === null || unitId === null || s.unitId === unitId),
  );
}

/** True if the subject covers the whole factory (needed to change factory-level things like shifts). */
export function hasFactoryWideScope(subject: ScopeSubject, factoryId: string): boolean {
  if (subject.isSuperAdmin) return true;
  return subject.scopes.some((s) => s.factoryId === factoryId && s.unitId === null);
}

/** Factories the subject can see (null = all, for super admins). */
export function scopedFactoryIds(subject: ScopeSubject): string[] | null {
  if (subject.isSuperAdmin) return null;
  return [...new Set(subject.scopes.map((s) => s.factoryId))];
}
