import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import type pg from 'pg';

// Plain-SQL migration runner (SPEC §7, CLAUDE.md). Each file runs in its own transaction and is
// recorded with a sha256 checksum; editing an applied file is refused instead of silently drifting.

export type MigrationFile = { version: string; file: string; sql: string; checksum: string };
export type MigrateResult = { applied: string[]; skipped: string[] };

const FILE_PATTERN = /^(\d{4})_[a-z0-9_]+\.sql$/;
// Arbitrary constant so two runners (e.g. two api containers starting) never interleave.
const ADVISORY_LOCK_KEY = 7_302_026;

export class MigrationError extends Error {
  override name = 'MigrationError';
}

export function checksum(sql: string): string {
  return createHash('sha256').update(sql.replace(/\r\n/g, '\n'), 'utf8').digest('hex');
}

export async function readMigrations(dir: string): Promise<MigrationFile[]> {
  const entries = (await readdir(dir)).filter((f) => f.endsWith('.sql')).sort();
  const seen = new Set<string>();
  const files: MigrationFile[] = [];
  for (const file of entries) {
    const match = FILE_PATTERN.exec(file);
    if (!match?.[1]) {
      throw new MigrationError(`Bad migration file name "${file}" (expected NNNN_snake_case.sql)`);
    }
    const version = match[1];
    if (seen.has(version)) throw new MigrationError(`Duplicate migration number ${version}`);
    seen.add(version);
    const sql = await readFile(path.join(dir, file), 'utf8');
    files.push({ version, file, sql, checksum: checksum(sql) });
  }
  return files;
}

export async function migrate(
  client: pg.ClientBase,
  dir: string,
  log: (msg: string) => void = () => undefined,
): Promise<MigrateResult> {
  const files = await readMigrations(dir);
  await client.query('select pg_advisory_lock($1)', [ADVISORY_LOCK_KEY]);
  try {
    await client.query(`create table if not exists schema_migrations (
      version text primary key,
      file text not null,
      checksum text not null,
      applied_at timestamptz not null default now()
    )`);
    const { rows } = await client.query<{ version: string; checksum: string; file: string }>(
      'select version, checksum, file from schema_migrations',
    );
    const applied = new Map(rows.map((r) => [r.version, r]));

    for (const row of rows) {
      if (!files.some((f) => f.version === row.version)) {
        throw new MigrationError(`Migration ${row.file} is applied in the database but missing on disk`);
      }
    }

    const result: MigrateResult = { applied: [], skipped: [] };
    for (const m of files) {
      const existing = applied.get(m.version);
      if (existing) {
        if (existing.checksum !== m.checksum) {
          throw new MigrationError(
            `Migration ${m.file} was edited after being applied (checksum mismatch). ` +
              'Write a new migration instead of changing an applied one.',
          );
        }
        result.skipped.push(m.file);
        continue;
      }
      log(`applying ${m.file}`);
      try {
        await client.query('begin');
        await client.query(m.sql);
        await client.query('insert into schema_migrations (version, file, checksum) values ($1, $2, $3)', [
          m.version,
          m.file,
          m.checksum,
        ]);
        await client.query('commit');
      } catch (err) {
        await client.query('rollback');
        throw new MigrationError(`Migration ${m.file} failed: ${(err as Error).message}`);
      }
      result.applied.push(m.file);
    }
    return result;
  } finally {
    await client.query('select pg_advisory_unlock($1)', [ADVISORY_LOCK_KEY]);
  }
}
