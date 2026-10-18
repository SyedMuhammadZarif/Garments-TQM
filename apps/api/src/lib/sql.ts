import { notFound, versionConflict } from './errors.js';
import type { Db } from '../db/tx.js';

// Helpers for the optimistic-concurrency update pattern (SPEC §3.3). Table and column names come only from
// code (checked by regex); values are always parameters.
const IDENT = /^[a-z_][a-z0-9_]*$/;

function ident(name: string): string {
  if (!IDENT.test(name)) throw new Error(`Unsafe SQL identifier: ${name}`);
  return name;
}

/** Maps camelCase input keys to columns; keys absent from `patch` are left unchanged. */
export function buildSet(columns: Record<string, string>, patch: Record<string, unknown>, params: unknown[]): string[] {
  const sets: string[] = [];
  for (const [key, column] of Object.entries(columns)) {
    if (patch[key] === undefined) continue;
    params.push(patch[key]);
    sets.push(`${ident(column)} = $${params.length}`);
  }
  return sets;
}

/**
 * UPDATE ... WHERE id AND version. Returns the updated row, or throws VERSION_CONFLICT with the current
 * row, or NOT_FOUND when the row is gone. `extraWhere` must be a code-built fragment (e.g. a scope clause).
 */
export async function updateVersioned<R>(
  db: Db,
  table: string,
  args: {
    id: string;
    version: number;
    userId: string;
    columns: Record<string, string>;
    patch: Record<string, unknown>;
    returning: string;
  },
): Promise<R> {
  const params: unknown[] = [args.id, args.version, args.userId];
  const sets = buildSet(args.columns, args.patch, params);
  const t = ident(table);
  const { rows } = await db.query(
    `update ${t} set ${[...sets, 'version = version + 1', 'updated_by = $3'].join(', ')}
      where id = $1 and version = $2 and deleted_at is null returning ${args.returning}`,
    params,
  );
  if (rows[0]) return rows[0] as R;
  const current = await db.query(`select ${args.returning} from ${t} where id = $1 and deleted_at is null`, [args.id]);
  if (!current.rows[0]) throw notFound();
  throw versionConflict(current.rows[0]);
}

export async function softDelete(db: Db, table: string, id: string, version: number, userId: string): Promise<void> {
  const t = ident(table);
  const { rowCount } = await db.query(
    `update ${t} set deleted_at = now(), version = version + 1, updated_by = $3
      where id = $1 and version = $2 and deleted_at is null`,
    [id, version, userId],
  );
  if (rowCount) return;
  const current = await db.query(`select id, version from ${t} where id = $1 and deleted_at is null`, [id]);
  if (!current.rows[0]) throw notFound();
  throw versionConflict(current.rows[0]);
}
