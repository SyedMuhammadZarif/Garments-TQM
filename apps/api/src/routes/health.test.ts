import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import { createApp } from '../app.js';
import { createPool } from '../db/pool.js';
import { testDatabaseUrl } from '../testing/testDb.js';
import { loadConfig } from '../config.js';

const config = (databaseUrl: string) => loadConfig({ DATABASE_URL: databaseUrl, JWT_SECRET: 'x'.repeat(32), LOG_LEVEL: 'error' });

async function getHealth(databaseUrl: string): Promise<{ status: number; body: unknown }> {
  const pool = createPool(databaseUrl);
  const server = createApp({ pool, config: config(databaseUrl) }).listen(0);
  await new Promise<void>((resolve) => server.once('listening', resolve));
  try {
    const { port } = server.address() as AddressInfo;
    const res = await fetch(`http://127.0.0.1:${port}/api/v1/health`);
    return { status: res.status, body: await res.json() };
  } finally {
    server.closeAllConnections();
    server.close();
    await pool.end();
  }
}

test('GET /api/v1/health reports db ok', async () => {
  const { status, body } = await getHealth(testDatabaseUrl());
  assert.equal(status, 200);
  const data = (body as { data: { status: string; db: string; time: string } }).data;
  assert.equal(data.status, 'ok');
  assert.equal(data.db, 'ok');
  assert.ok(!Number.isNaN(Date.parse(data.time)));
});

test('GET /api/v1/health returns 503 when the database is unreachable', async () => {
  const { status, body } = await getHealth('postgres://nobody:x@127.0.0.1:1/none');
  assert.equal(status, 503);
  assert.equal((body as { data: { db: string } }).data.db, 'down');
});

test('unknown API routes behind auth return the error envelope', async () => {
  const pool = createPool(testDatabaseUrl());
  const server = createApp({ pool, config: config(testDatabaseUrl()) }).listen(0);
  await new Promise<void>((resolve) => server.once('listening', resolve));
  try {
    const { port } = server.address() as AddressInfo;
    const res = await fetch(`http://127.0.0.1:${port}/api/v1/nope`);
    assert.equal(res.status, 401);
    assert.deepEqual(await res.json(), { error: { code: 'UNAUTHENTICATED', message: 'Please log in' } });
  } finally {
    server.closeAllConnections();
    server.close();
    await pool.end();
  }
});
