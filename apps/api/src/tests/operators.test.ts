import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import type { OperatorImportResult } from '@tqm/shared';
import { call, createFactory, createLine, createUnit, createUser, login, startTestApp, type TestApp } from '../testing/testApp.js';

describe('operators CSV import', () => {
  let t: TestApp;
  let factory: string;
  let token: string;
  before(async () => {
    t = await startTestApp();
    factory = await createFactory(t, 'DA');
    const u1 = await createUnit(t, factory, 'U1');
    await createLine(t, factory, u1, 'L01');
    await createUnit(t, factory, 'U2');
    const admin = await createUser(t, { roleKey: 'factory_admin', scopes: [{ factoryId: factory, unitId: null }] });
    token = (await login(t, admin.username)).accessToken;
  });
  after(() => t.close());

  const csv = (rows: string[]) => ['code,name,unit_code,line_code,skill_grade,active', ...rows].join('\n');

  test('dry run previews creates; errors block the whole import with a row-level report', async () => {
    const bad = await call<OperatorImportResult>(t, 'POST', '/operators/import', {
      token,
      body: { factoryId: factory, dryRun: false, csv: csv(['E1,Rahim,U1,L01,A,yes', 'E2,,U1,,,', 'E3,Karim,U9,,,', 'E1,Dup,U1,,,', 'E4,Selim,U2,L01,,maybe']) },
    });
    assert.equal(bad.status, 200);
    assert.equal(bad.body.data?.committed, false);
    assert.deepEqual(
      bad.body.data?.rows.map((r) => [r.row, r.action, r.errors.length]),
      [[2, 'create', 0], [3, 'error', 1], [4, 'error', 1], [5, 'error', 1], [6, 'error', 2]],
    );
    const { rows } = await t.pool.query<{ n: number }>('select count(*)::int as n from operators');
    assert.equal(rows[0]?.n, 0);
  });

  test('a clean file creates, then a second import updates by code', async () => {
    const first = await call<OperatorImportResult>(t, 'POST', '/operators/import', {
      token,
      body: { factoryId: factory, dryRun: false, csv: '﻿' + csv(['E1,Rahim,U1,L01,A,yes', 'E2,"Begum, Ayesha",U2,,B,']) },
    });
    assert.equal(first.body.data?.committed, true);
    assert.equal(first.body.data?.created, 2);

    const preview = await call<OperatorImportResult>(t, 'POST', '/operators/import', {
      token,
      body: { factoryId: factory, dryRun: true, csv: csv(['E1,Rahim Uddin,U2,,A,no', 'E3,New,U1,,,']) },
    });
    assert.deepEqual(preview.body.data?.rows.map((r) => r.action), ['update', 'create']);
    assert.equal(preview.body.data?.committed, false);

    await call(t, 'POST', '/operators/import', { token, body: { factoryId: factory, dryRun: false, csv: csv(['E1,Rahim Uddin,U2,,A,no']) } });
    const list = await call<{ code: string; name: string; isActive: boolean; lineId: string | null }[]>(t, 'GET', '/operators?q=E1', { token });
    assert.deepEqual(list.body.data?.map((o) => [o.code, o.name, o.isActive, o.lineId]), [['E1', 'Rahim Uddin', false, null]]);
  });

  test('operator list paginates with a cursor', async () => {
    const rows = Array.from({ length: 7 }, (_, i) => `P${String(i).padStart(2, '0')},Op ${i},U1,,,`);
    await call(t, 'POST', '/operators/import', { token, body: { factoryId: factory, dryRun: false, csv: csv(rows) } });
    const seen: string[] = [];
    let cursor: string | null = null;
    do {
      const res: Awaited<ReturnType<typeof call<{ code: string }[]>>> = await call<{ code: string }[]>(
        t, 'GET', `/operators?q=P&limit=3${cursor ? `&cursor=${cursor}` : ''}`, { token },
      );
      seen.push(...res.body.data!.map((o) => o.code));
      cursor = (res.body.meta as { nextCursor: string | null }).nextCursor;
    } while (cursor);
    assert.deepEqual(seen, ['P00', 'P01', 'P02', 'P03', 'P04', 'P05', 'P06']);
  });
});
