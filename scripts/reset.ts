import path from 'node:path';
import { spawnSync } from 'node:child_process';
import pg from 'pg';
import { runMigrateCli } from '../apps/api/src/cli/migrate.js';

// Dev-only: drop and recreate the database, migrate, then seed base data (CLAUDE.md commands).
async function main(): Promise<void> {
  if (process.env.NODE_ENV === 'production') {
    throw new Error('db:reset refuses to run with NODE_ENV=production');
  }
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error('DATABASE_URL is required');

  const target = new URL(databaseUrl);
  const dbName = decodeURIComponent(target.pathname.slice(1));
  if (!/^[a-z0-9_]+$/i.test(dbName))
    throw new Error(`Refusing to reset database with unusual name "${dbName}"`);

  // Connect to the maintenance database to drop/create the target.
  const admin = new URL(databaseUrl);
  admin.pathname = '/postgres';
  const client = new pg.Client({ connectionString: admin.toString() });
  await client.connect();
  try {
    console.log(`dropping database ${dbName}`);
    // Identifiers cannot be parameterised; dbName is validated above.
    await client.query(`drop database if exists "${dbName}" with (force)`);
    await client.query(`create database "${dbName}"`);
  } finally {
    await client.end();
  }

  await runMigrateCli(databaseUrl, path.resolve(import.meta.dirname, '../db/migrations'));

  const seed = spawnSync('npm', ['run', 'seed:base'], {
    stdio: 'inherit',
    cwd: path.resolve(import.meta.dirname, '..'),
  });
  if (seed.status !== 0) throw new Error('seed:base failed');
}

main().catch((err: unknown) => {
  console.error((err as Error).message);
  process.exit(1);
});
