import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { call, createFactory, createLine, createUnit, createUser, login, startTestApp, type TestApp } from '../testing/testApp.js';

describe('permissions and data scope', () => {
  let t: TestApp;
  let factoryA: string;
  let factoryB: string;
  let unitA1: string;
  let unitA2: string;
  let lineA2: string;
  before(async () => {
    t = await startTestApp();
    factoryA = await createFactory(t, 'FA');
    factoryB = await createFactory(t, 'FB');
    unitA1 = await createUnit(t, factoryA, 'U1');
    unitA2 = await createUnit(t, factoryA, 'U2');
    lineA2 = await createLine(t, factoryA, unitA2, 'L1');
  });
  after(() => t.close());

  test('a user without the permission is refused', async () => {
    const inspector = await createUser(t, { roleKey: 'line_qc_inspector', scopes: [{ factoryId: factoryA, unitId: null }] });
    const s = await login(t, inspector.username);
    const res = await call(t, 'POST', '/units', {
      token: s.accessToken,
      body: { id: randomUUID(), factoryId: factoryA, code: 'U9', name: 'X' },
    });
    assert.equal(res.status, 403);
    assert.equal(res.body.error?.code, 'FORBIDDEN');
    assert.equal((await call(t, 'GET', '/users', { token: s.accessToken })).status, 403);
  });

  test('a unit-scoped user cannot read another unit by id, and lists only show their unit', async () => {
    const u = await createUser(t, { roleKey: 'supervisor', scopes: [{ factoryId: factoryA, unitId: unitA1 }] });
    const s = await login(t, u.username);

    const own = await call(t, 'GET', `/units/${unitA1}`, { token: s.accessToken });
    assert.equal(own.status, 200);
    const other = await call(t, 'GET', `/units/${unitA2}`, { token: s.accessToken });
    assert.equal(other.status, 404);
    assert.equal(other.body.error?.code, 'OUT_OF_SCOPE');
    assert.equal((await call(t, 'GET', `/lines/${lineA2}`, { token: s.accessToken })).status, 404);

    const units = await call<{ id: string }[]>(t, 'GET', '/units', { token: s.accessToken });
    assert.deepEqual(units.body.data?.map((x) => x.id), [unitA1]);
    const lines = await call<unknown[]>(t, 'GET', '/lines', { token: s.accessToken });
    assert.deepEqual(lines.body.data, []);
  });

  test('a user of factory A cannot see factory B at all', async () => {
    const u = await createUser(t, { roleKey: 'qa_manager', scopes: [{ factoryId: factoryA, unitId: null }] });
    const s = await login(t, u.username);
    assert.equal((await call(t, 'GET', `/factories/${factoryB}`, { token: s.accessToken })).status, 404);
    const list = await call<{ id: string }[]>(t, 'GET', '/factories', { token: s.accessToken });
    assert.deepEqual(list.body.data?.map((f) => f.id), [factoryA]);
  });

  test('operators outside scope are invisible by id and in lists', async () => {
    const admin = await createUser(t, { roleKey: 'factory_admin', scopes: [{ factoryId: factoryA, unitId: null }] });
    const sa = await login(t, admin.username);
    const opId = randomUUID();
    const created = await call(t, 'POST', '/operators', { token: sa.accessToken, body: { id: opId, unitId: unitA2, code: 'E100', name: 'Rahim' } });
    assert.equal(created.status, 201);

    const unit1User = await createUser(t, { roleKey: 'supervisor', scopes: [{ factoryId: factoryA, unitId: unitA1 }] });
    const s1 = await login(t, unit1User.username);
    assert.equal((await call(t, 'GET', `/operators/${opId}`, { token: s1.accessToken })).status, 404);
    const list = await call<unknown[]>(t, 'GET', '/operators', { token: s1.accessToken });
    assert.deepEqual(list.body.data, []);
  });

  test('a factory admin cannot grant scopes in another factory or the super admin role', async () => {
    const admin = await createUser(t, { roleKey: 'factory_admin', scopes: [{ factoryId: factoryA, unitId: null }] });
    const s = await login(t, admin.username);
    const roles = await call<{ id: string; key: string }[]>(t, 'GET', '/roles', { token: s.accessToken });
    const inspectorRole = roles.body.data!.find((r) => r.key === 'line_qc_inspector')!.id;
    const superRole = roles.body.data!.find((r) => r.key === 'super_admin')!.id;

    const base = { username: `emp${Date.now()}`, fullName: 'New Person' };
    const otherFactory = await call(t, 'POST', '/users', {
      token: s.accessToken,
      body: { ...base, id: randomUUID(), roleIds: [inspectorRole], scopes: [{ factoryId: factoryB, unitId: null, stage: null, buyerId: null }] },
    });
    assert.equal(otherFactory.status, 403);
    const superAdmin = await call(t, 'POST', '/users', {
      token: s.accessToken,
      body: { ...base, id: randomUUID(), roleIds: [superRole], scopes: [{ factoryId: factoryA, unitId: null, stage: null, buyerId: null }] },
    });
    assert.equal(superAdmin.status, 403);

    const ok = await call<{ temporaryPassword: string; user: { mustChangePassword: boolean } }>(t, 'POST', '/users', {
      token: s.accessToken,
      body: { ...base, id: randomUUID(), roleIds: [inspectorRole], scopes: [{ factoryId: factoryA, unitId: unitA1, stage: null, buyerId: null }] },
    });
    assert.equal(ok.status, 201);
    assert.equal(ok.body.data?.user.mustChangePassword, true);
    assert.match(ok.body.data?.temporaryPassword ?? '', /^(?=.*[A-Za-z])(?=.*\d).{10}$/);
  });

  test('bootstrap returns the right shell and only in-scope org data', async () => {
    const inspector = await createUser(t, { roleKey: 'line_qc_inspector', scopes: [{ factoryId: factoryA, unitId: unitA2 }] });
    const gm = await createUser(t, { roleKey: 'management', scopes: [{ factoryId: factoryA, unitId: null }] });
    const si = await login(t, inspector.username);
    const sg = await login(t, gm.username);
    const bi = await call<{ shell: string; units: { id: string }[]; lines: { id: string }[]; factories: { settings: { currency: string } }[] }>(
      t, 'GET', '/meta/bootstrap', { token: si.accessToken },
    );
    assert.equal(bi.body.data?.shell, 'floor');
    assert.deepEqual(bi.body.data?.units.map((u) => u.id), [unitA2]);
    assert.deepEqual(bi.body.data?.lines.map((l) => l.id), [lineA2]);
    assert.equal(bi.body.data?.factories[0]?.settings.currency, 'USD');
    const bg = await call<{ shell: string; floorAllowed: boolean }>(t, 'GET', '/meta/bootstrap', { token: sg.accessToken });
    assert.equal(bg.body.data?.shell, 'desk');
    assert.equal(bg.body.data?.floorAllowed, false);
    // Management may not switch to the Floor shell.
    const me = await call<{ version: number }>(t, 'GET', '/me', { token: sg.accessToken });
    const sw = await call(t, 'PATCH', '/me', { token: sg.accessToken, body: { version: me.body.data!.version, preferredShell: 'floor' } });
    assert.equal(sw.status, 403);
  });
});
