import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { MigrationError, migrate, readMigrations } from './migrations.js';
import { withTestSchema } from '../testing/testDb.js';

async function tempDir(files: Record<string, string>): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), 'tqm-mig-'));
  for (const [name, sql] of Object.entries(files)) await writeFile(path.join(dir, name), sql);
  return dir;
}

test('applies pending migrations in order and skips applied ones', async () => {
  const dir = await tempDir({
    '0002_b.sql': 'create table b (id int references a(id));',
    '0001_a.sql': 'create table a (id int primary key);',
  });
  try {
    await withTestSchema(async (client) => {
      const first = await migrate(client, dir);
      assert.deepEqual(first.applied, ['0001_a.sql', '0002_b.sql']);
      const second = await migrate(client, dir);
      assert.deepEqual(second.applied, []);
      assert.deepEqual(second.skipped, ['0001_a.sql', '0002_b.sql']);
    });
  } finally {
    await rm(dir, { recursive: true });
  }
});

test('refuses to run when an applied migration was edited', async () => {
  const dir = await tempDir({ '0001_a.sql': 'create table a (id int);' });
  try {
    await withTestSchema(async (client) => {
      await migrate(client, dir);
      await writeFile(path.join(dir, '0001_a.sql'), 'create table a (id bigint);');
      await assert.rejects(migrate(client, dir), /edited after being applied/);
    });
  } finally {
    await rm(dir, { recursive: true });
  }
});

test('a failing migration rolls back and is not recorded', async () => {
  const dir = await tempDir({
    '0001_ok.sql': 'create table ok (id int);',
    '0002_bad.sql': 'create table half (id int); select * from does_not_exist;',
  });
  try {
    await withTestSchema(async (client, schema) => {
      await assert.rejects(migrate(client, dir), /0002_bad\.sql failed/);
      const { rows } = await client.query<{ version: string }>('select version from schema_migrations');
      assert.deepEqual(
        rows.map((r) => r.version),
        ['0001'],
      );
      const half = await client.query<{ t: string | null }>('select to_regclass($1) as t', [
        `${schema}.half`,
      ]);
      assert.equal(half.rows[0]?.t, null);
    });
  } finally {
    await rm(dir, { recursive: true });
  }
});

test('rejects badly named and duplicate migration files', async () => {
  const bad = await tempDir({ '1_x.sql': '' });
  const dup = await tempDir({ '0001_a.sql': '', '0001_b.sql': '' });
  try {
    await assert.rejects(readMigrations(bad), MigrationError);
    await assert.rejects(readMigrations(dup), /Duplicate migration number 0001/);
  } finally {
    await rm(bad, { recursive: true });
    await rm(dup, { recursive: true });
  }
});

test('the real migrations apply cleanly on an empty schema', async () => {
  const dir = path.resolve(import.meta.dirname, '../../../../db/migrations');
  assert.ok((await readdir(dir)).length > 0);
  await withTestSchema(async (client) => {
    const result = await migrate(client, dir);
    assert.ok(result.applied.includes('0001_extensions_enums.sql'));
    const { rows } = await client.query<{ n: string }>(
      "select count(*)::text as n from pg_type where typname in ('stage','inspection_type','severity')",
    );
    assert.ok(Number(rows[0]?.n) >= 3);
  });
});
