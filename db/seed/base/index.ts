import pg from 'pg';
import { seedBase } from '../../../apps/api/src/seed/base.js';

// seed:base (SPEC §20.1). Defect library, AQL tables, garment templates and checklist templates are added in
// Milestone 3; see docs/PROGRESS.md.
async function main(): Promise<void> {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL is required');
  const client = new pg.Client({ connectionString: url });
  await client.connect();
  try {
    await seedBase(client, {
      adminUsername: process.env.SEED_ADMIN_USERNAME,
      adminPassword: process.env.SEED_ADMIN_PASSWORD,
      bcryptRounds: Number(process.env.BCRYPT_ROUNDS ?? 12),
      log: (m) => console.log(`seed:base ${m}`),
    });
  } finally {
    await client.end();
  }
}

main().catch((err: unknown) => {
  console.error((err as Error).message);
  process.exit(1);
});
