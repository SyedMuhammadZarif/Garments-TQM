import path from 'node:path';
import { runMigrateCli } from '../apps/api/src/cli/migrate.js';

runMigrateCli(process.env.DATABASE_URL, path.resolve(import.meta.dirname, '../db/migrations')).catch(
  (err: unknown) => {
    console.error((err as Error).message);
    process.exit(1);
  },
);
