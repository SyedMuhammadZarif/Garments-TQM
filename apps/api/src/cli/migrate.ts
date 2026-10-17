import path from 'node:path';
import pg from 'pg';
import { migrate } from '../db/migrations.js';

// Used by `npm run db:migrate` (via scripts/migrate.ts) and by the api container on start.
export async function runMigrateCli(databaseUrl: string | undefined, dir: string): Promise<void> {
  if (!databaseUrl) throw new Error('DATABASE_URL is required');
  const client = new pg.Client({ connectionString: databaseUrl });
  await client.connect();
  try {
    const result = await migrate(client, dir, (msg) => console.log(msg));
    console.log(
      result.applied.length === 0
        ? `Database is up to date (${result.skipped.length} migrations).`
        : `Applied ${result.applied.length} migration(s).`,
    );
  } finally {
    await client.end();
  }
}

const isEntry = process.argv[1] !== undefined && import.meta.filename === path.resolve(process.argv[1]);
if (isEntry) {
  runMigrateCli(process.env.DATABASE_URL, path.resolve(process.env.MIGRATIONS_DIR ?? 'db/migrations')).catch(
    (err: unknown) => {
      console.error((err as Error).message);
      process.exit(1);
    },
  );
}
