import { randomBytes } from 'node:crypto';
import pg from 'pg';

// Integration tests run against DATABASE_URL_TEST (SPEC §22.1). Each test gets its own throwaway
// schema so tests never see each other's tables and never touch the dev database.
export function testDatabaseUrl(): string {
  const url = process.env.DATABASE_URL_TEST;
  if (!url) throw new Error('DATABASE_URL_TEST is required for integration tests (see .env.example)');
  return url;
}

export async function withTestSchema<T>(fn: (client: pg.Client, schema: string) => Promise<T>): Promise<T> {
  const schema = `test_${randomBytes(6).toString('hex')}`;
  const client = new pg.Client({ connectionString: testDatabaseUrl() });
  await client.connect();
  try {
    await client.query(`create schema ${schema}`);
    await client.query(`set search_path to ${schema}, public`);
    return await fn(client, schema);
  } finally {
    await client.query(`drop schema if exists ${schema} cascade`);
    await client.end();
  }
}
