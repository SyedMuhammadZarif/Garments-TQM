import { randomBytes, randomUUID } from 'node:crypto';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import bcrypt from 'bcrypt';
import pg from 'pg';
import type { PermissionKey, UserScope } from '@tqm/shared';
import { createApp } from '../app.js';
import { loadConfig, type Config } from '../config.js';
import { migrate } from '../db/migrations.js';
import { seedBase } from '../seed/base.js';
import { authCache } from '../lib/authCache.js';
import { testDatabaseUrl } from './testDb.js';

const MIGRATIONS = path.resolve(import.meta.dirname, '../../../../db/migrations');
export const TEST_PASSWORD = 'Test@1234';

export type TestApp = {
  pool: pg.Pool;
  config: Config;
  url: string;
  schema: string;
  close: () => Promise<void>;
};

/** A real API on a random port, backed by a freshly migrated and seeded schema of the test database. */
export async function startTestApp(): Promise<TestApp> {
  const schema = `test_${randomBytes(6).toString('hex')}`;
  const base = testDatabaseUrl();
  const admin = new pg.Client({ connectionString: base });
  await admin.connect();
  await admin.query(`create schema ${schema}`);
  await admin.query(`set search_path to ${schema}, public`);
  await migrate(admin, MIGRATIONS);
  await seedBase(admin, { adminUsername: undefined, adminPassword: undefined, bcryptRounds: 4 });
  await admin.end();

  const url = new URL(base);
  url.searchParams.set('options', `-c search_path=${schema},public`);
  const config = loadConfig({
    NODE_ENV: 'test',
    DATABASE_URL: url.toString(),
    JWT_SECRET: randomBytes(32).toString('hex'),
    BCRYPT_ROUNDS: '4',
    LOG_LEVEL: 'error',
  });
  const pool = new pg.Pool({ connectionString: config.databaseUrl, max: 10 });
  const server: Server = createApp({ pool, config }).listen(0);
  await new Promise<void>((r) => server.once('listening', () => r()));
  const { port } = server.address() as AddressInfo;
  authCache.clear();

  return {
    pool,
    config,
    url: `http://127.0.0.1:${port}/api/v1`,
    schema,
    close: async () => {
      server.closeAllConnections();
      server.close();
      await pool.end();
      const c = new pg.Client({ connectionString: base });
      await c.connect();
      await c.query(`drop schema if exists ${schema} cascade`);
      await c.end();
    },
  };
}

// ---- fixtures (direct SQL, bypassing the API, so tests set up state quickly) ------------------------------

export async function createFactory(t: TestApp, code: string): Promise<string> {
  const id = randomUUID();
  await t.pool.query("insert into factories (id, code, name, settings) values ($1, $2, $3, '{}')", [id, code, `Factory ${code}`]);
  return id;
}

export async function createUnit(t: TestApp, factoryId: string, code: string): Promise<string> {
  const id = randomUUID();
  await t.pool.query('insert into units (id, factory_id, code, name) values ($1, $2, $3, $4)', [id, factoryId, code, `Unit ${code}`]);
  return id;
}

export async function createLine(t: TestApp, factoryId: string, unitId: string, code: string): Promise<string> {
  const id = randomUUID();
  await t.pool.query('insert into lines (id, factory_id, unit_id, code, name) values ($1, $2, $3, $4, $5)', [
    id,
    factoryId,
    unitId,
    code,
    `Line ${code}`,
  ]);
  return id;
}

export async function createUser(
  t: TestApp,
  opts: {
    username?: string;
    roleKey?: string;
    permissions?: PermissionKey[];
    scopes?: Omit<UserScope, 'id' | 'stage' | 'buyerId'>[];
    superAdmin?: boolean;
    mustChangePassword?: boolean;
  },
): Promise<{ id: string; username: string }> {
  const id = randomUUID();
  const username = opts.username ?? `u_${randomBytes(4).toString('hex')}`;
  await t.pool.query(
    `insert into users (id, username, full_name, password_hash, must_change_password, is_super_admin)
     values ($1, $2, $3, $4, $5, $6)`,
    [id, username, `User ${username}`, await bcrypt.hash(TEST_PASSWORD, 4), opts.mustChangePassword ?? false, opts.superAdmin ?? false],
  );
  if (opts.roleKey) {
    await t.pool.query('insert into user_roles (user_id, role_id) select $1, id from roles where key = $2', [id, opts.roleKey]);
  }
  if (opts.permissions) {
    const roleId = randomUUID();
    await t.pool.query("insert into roles (id, key, name, default_shell) values ($1, $2, 'Test role', 'desk')", [roleId, `r_${roleId.slice(0, 8)}`]);
    await t.pool.query('insert into role_permissions (role_id, permission_key) select $1, unnest($2::text[])', [roleId, opts.permissions]);
    await t.pool.query('insert into user_roles (user_id, role_id) values ($1, $2)', [id, roleId]);
  }
  for (const s of opts.scopes ?? []) {
    await t.pool.query('insert into user_scopes (user_id, factory_id, unit_id) values ($1, $2, $3)', [id, s.factoryId, s.unitId]);
  }
  return { id, username };
}

// ---- HTTP helpers -----------------------------------------------------------------------------------------

export type Res<T = unknown> = { status: number; body: { data?: T; error?: { code: string; message: string; details?: unknown }; meta?: unknown }; headers: Headers };

export async function call<T = unknown>(
  t: TestApp,
  method: string,
  path: string,
  opts: { token?: string; body?: unknown; idempotencyKey?: string } = {},
): Promise<Res<T>> {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (opts.token) headers.authorization = `Bearer ${opts.token}`;
  if (opts.idempotencyKey) headers['idempotency-key'] = opts.idempotencyKey;
  const res = await fetch(t.url + path, {
    method,
    headers,
    ...(opts.body !== undefined ? { body: JSON.stringify(opts.body) } : {}),
  });
  return { status: res.status, body: (await res.json()) as Res<T>['body'], headers: res.headers };
}

export async function login(t: TestApp, username: string, deviceId = 'test-device'): Promise<{ accessToken: string; refreshToken: string }> {
  const res = await call<{ accessToken: string; refreshToken: string }>(t, 'POST', '/auth/login', {
    body: { username, password: TEST_PASSWORD, deviceId },
  });
  if (res.status !== 200 || !res.body.data) throw new Error(`login failed: ${res.status} ${JSON.stringify(res.body)}`);
  return res.body.data;
}
