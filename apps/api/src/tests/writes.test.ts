import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { call, createFactory, createUnit, createUser, login, startTestApp, type TestApp } from '../testing/testApp.js';

describe('idempotency, versions, audit log', () => {
  let t: TestApp;
  let factory: string;
  let unit: string;
  let token: string;
  let adminId: string;
  before(async () => {
    t = await startTestApp();
    factory = await createFactory(t, 'DA');
    unit = await createUnit(t, factory, 'U1');
    const admin = await createUser(t, { roleKey: 'factory_admin', scopes: [{ factoryId: factory, unitId: null }] });
    adminId = admin.id;
    token = (await login(t, admin.username)).accessToken;
  });
  after(() => t.close());

  test('a retried request with the same Idempotency-Key replays the first response and writes once', async () => {
    const key = randomUUID();
    const body = { id: randomUUID(), unitId: unit, code: 'L-07', name: 'Line 07', lineType: 'sewing' };
    const first = await call<{ id: string }>(t, 'POST', '/lines', { token, body, idempotencyKey: key });
    const retry = await call<{ id: string }>(t, 'POST', '/lines', { token, body, idempotencyKey: key });
    assert.equal(first.status, 201);
    assert.equal(retry.status, 201);
    assert.equal(retry.headers.get('idempotent-replay'), 'true');
    assert.deepEqual(retry.body, first.body);
    const { rows } = await t.pool.query<{ n: number }>("select count(*)::int as n from lines where code = 'L-07'");
    assert.equal(rows[0]?.n, 1);
  });

  test('concurrent duplicates still write once', async () => {
    const key = randomUUID();
    const body = { id: randomUUID(), unitId: unit, code: 'L-08', name: 'Line 08', lineType: 'sewing' };
    const results = await Promise.all([1, 2, 3].map(() => call(t, 'POST', '/lines', { token, body, idempotencyKey: key })));
    assert.deepEqual(results.map((r) => r.status), [201, 201, 201]);
    const { rows } = await t.pool.query<{ n: number }>("select count(*)::int as n from lines where code = 'L-08'");
    assert.equal(rows[0]?.n, 1);
  });

  test('reusing a key with a different body is rejected', async () => {
    const key = randomUUID();
    await call(t, 'POST', '/lines', { token, idempotencyKey: key, body: { id: randomUUID(), unitId: unit, code: 'L-09', name: 'A', lineType: 'sewing' } });
    const other = await call(t, 'POST', '/lines', { token, idempotencyKey: key, body: { id: randomUUID(), unitId: unit, code: 'L-10', name: 'B', lineType: 'sewing' } });
    assert.equal(other.status, 422);
    assert.equal(other.body.error?.code, 'IDEMPOTENCY_MISMATCH');
  });

  test('a duplicate client id without a key is reported as DUPLICATE, not a server error', async () => {
    const id = randomUUID();
    await call(t, 'POST', '/lines', { token, body: { id, unitId: unit, code: 'L-11', name: 'A', lineType: 'sewing' } });
    const dup = await call(t, 'POST', '/lines', { token, body: { id, unitId: unit, code: 'L-12', name: 'B', lineType: 'sewing' } });
    assert.equal(dup.status, 409);
    assert.equal(dup.body.error?.code, 'DUPLICATE');
  });

  test('updating with a stale version returns VERSION_CONFLICT with the current row', async () => {
    const id = randomUUID();
    await call(t, 'POST', '/lines', { token, body: { id, unitId: unit, code: 'L-20', name: 'Line 20', lineType: 'sewing' } });
    const a = await call<{ version: number; name: string }>(t, 'PATCH', `/lines/${id}`, { token, body: { version: 1, name: 'Line Twenty' } });
    assert.equal(a.status, 200);
    assert.equal(a.body.data?.version, 2);
    const stale = await call(t, 'PATCH', `/lines/${id}`, { token, body: { version: 1, name: 'Overwrite' } });
    assert.equal(stale.status, 409);
    assert.equal(stale.body.error?.code, 'VERSION_CONFLICT');
    assert.deepEqual((stale.body.error?.details as { current: { name: string; version: number } }).current.name, 'Line Twenty');
  });

  test('every change writes an audit_log row attributed to the user, soft deletes included', async () => {
    const id = randomUUID();
    await call(t, 'POST', '/lines', { token, body: { id, unitId: unit, code: 'L-30', name: 'Line 30', lineType: 'sewing' } });
    await call(t, 'PATCH', `/lines/${id}`, { token, body: { version: 1, name: 'Line Thirty' } });
    await call(t, 'DELETE', `/lines/${id}?version=2`, { token });
    const { rows } = await t.pool.query<{ action: string; user_id: string; factory_id: string; changed_fields: string[]; request_id: string | null }>(
      "select action, user_id, factory_id, changed_fields, request_id from audit_log where table_name = 'lines' and row_id = $1 order by id",
      [id],
    );
    assert.deepEqual(rows.map((r) => r.action), ['insert', 'update', 'soft_delete']);
    for (const r of rows) {
      assert.equal(r.user_id, adminId);
      assert.equal(r.factory_id, factory);
      assert.ok(r.request_id);
    }
    assert.deepEqual(rows[1]?.changed_fields, ['name', 'updated_by']);
    const gone = await call(t, 'GET', `/lines/${id}`, { token });
    assert.equal(gone.status, 404);
  });

  test('audit_log is append-only and never stores password hashes', async () => {
    await assert.rejects(t.pool.query('delete from audit_log'), /append-only/);
    await assert.rejects(t.pool.query("update audit_log set action = 'insert'"), /append-only/);
    const { rows } = await t.pool.query<{ n: number }>("select count(*)::int as n from audit_log where table_name = 'users' and (new_data ? 'password_hash' or old_data ? 'password_hash')");
    assert.equal(rows[0]?.n, 0);
  });

  test('invalid input returns field-level validation issues', async () => {
    const res = await call(t, 'POST', '/lines', { token, body: { id: 'nope', unitId: unit, code: '', lineType: 'weaving' } });
    assert.equal(res.status, 400);
    const paths = (res.body.error?.details as { issues: { path: string }[] }).issues.map((i) => i.path).sort();
    assert.deepEqual(paths, ['code', 'id', 'lineType', 'name']);
  });

  test('settings are validated and versioned', async () => {
    const f = await call<{ version: number; settings: Record<string, unknown> }>(t, 'GET', `/factories/${factory}`, { token });
    const settings = { ...f.body.data!.settings, dhu_thresholds: { green_max: 2.5, amber_max: 4.5 } };
    const ok = await call<{ settings: { dhu_thresholds: { green_max: number } } }>(t, 'PATCH', `/factories/${factory}/settings`, {
      token,
      body: { version: f.body.data!.version, settings },
    });
    assert.equal(ok.status, 200);
    assert.equal(ok.body.data?.settings.dhu_thresholds.green_max, 2.5);
    const bad = await call(t, 'PATCH', `/factories/${factory}/settings`, {
      token,
      body: { version: f.body.data!.version + 1, settings: { ...settings, dhu_thresholds: { green_max: 5, amber_max: 1 } } },
    });
    assert.equal(bad.status, 400);
  });
});
