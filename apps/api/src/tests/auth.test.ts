import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { call, createUser, login, startTestApp, TEST_PASSWORD, type TestApp } from '../testing/testApp.js';

describe('auth', () => {
  let t: TestApp;
  before(async () => {
    t = await startTestApp();
  });
  after(() => t.close());

  test('login returns tokens and the user; bad password gets a generic error', async () => {
    const u = await createUser(t, { roleKey: 'line_qc_inspector' });
    const ok = await call<{ accessToken: string; user: { username: string; roles: { key: string }[] } }>(t, 'POST', '/auth/login', {
      body: { username: u.username, password: TEST_PASSWORD, deviceId: 'd1' },
    });
    assert.equal(ok.status, 200);
    assert.equal(ok.body.data?.user.username, u.username);
    assert.deepEqual(ok.body.data?.user.roles.map((r) => r.key), ['line_qc_inspector']);

    const bad = await call(t, 'POST', '/auth/login', { body: { username: u.username, password: 'wrong-pass1', deviceId: 'd1' } });
    const unknown = await call(t, 'POST', '/auth/login', { body: { username: 'nobody', password: 'wrong-pass1', deviceId: 'd1' } });
    assert.equal(bad.status, 401);
    assert.deepEqual(bad.body.error, unknown.body.error);
    assert.equal(bad.body.error?.message, 'Invalid username or password');
  });

  test('refresh rotates the token; reusing the old one revokes the whole device session', async () => {
    const u = await createUser(t, { roleKey: 'supervisor' });
    const first = await login(t, u.username, 'tablet-1');

    const rotated = await call<{ accessToken: string; refreshToken: string }>(t, 'POST', '/auth/refresh', {
      body: { refreshToken: first.refreshToken, deviceId: 'tablet-1' },
    });
    assert.equal(rotated.status, 200);
    assert.notEqual(rotated.body.data?.refreshToken, first.refreshToken);
    assert.equal((await call(t, 'GET', '/me', { token: rotated.body.data!.accessToken })).status, 200);

    // An attacker replays the old token: rejected, and the legitimate new token dies with it.
    const replay = await call(t, 'POST', '/auth/refresh', { body: { refreshToken: first.refreshToken, deviceId: 'tablet-1' } });
    assert.equal(replay.status, 401);
    const afterReplay = await call(t, 'POST', '/auth/refresh', {
      body: { refreshToken: rotated.body.data!.refreshToken, deviceId: 'tablet-1' },
    });
    assert.equal(afterReplay.status, 401);
  });

  test('refresh from another device id is rejected', async () => {
    const u = await createUser(t, { roleKey: 'supervisor' });
    const s = await login(t, u.username, 'tablet-1');
    const res = await call(t, 'POST', '/auth/refresh', { body: { refreshToken: s.refreshToken, deviceId: 'other' } });
    assert.equal(res.status, 401);
  });

  test('logout ends the session for access and refresh', async () => {
    const u = await createUser(t, { roleKey: 'supervisor' });
    const s = await login(t, u.username);
    assert.equal((await call(t, 'POST', '/auth/logout', { body: { refreshToken: s.refreshToken } })).status, 200);
    assert.equal((await call(t, 'POST', '/auth/refresh', { body: { refreshToken: s.refreshToken, deviceId: 'test-device' } })).status, 401);
    // The access token is refused once the 30 s permission cache expires; the cache is cleared on logout.
    assert.equal((await call(t, 'GET', '/me', { token: s.accessToken })).status, 401);
  });

  test('five failed attempts lock the account for 15 minutes', async () => {
    const u = await createUser(t, { roleKey: 'supervisor' });
    for (let i = 0; i < 5; i++) {
      await call(t, 'POST', '/auth/login', { body: { username: u.username, password: 'wrong-pass1', deviceId: 'd' } });
    }
    const locked = await call(t, 'POST', '/auth/login', { body: { username: u.username, password: TEST_PASSWORD, deviceId: 'd' } });
    assert.equal(locked.status, 401);
    const { rows } = await t.pool.query<{ locked: boolean }>('select locked_until > now() as locked from users where id = $1', [u.id]);
    assert.equal(rows[0]?.locked, true);
  });

  test('an access token is rejected when invalid, and API routes need one', async () => {
    assert.equal((await call(t, 'GET', '/me')).status, 401);
    const res = await call(t, 'GET', '/me', { token: 'not.a.jwt' });
    assert.equal(res.status, 401);
    assert.equal(res.body.error?.code, 'UNAUTHENTICATED');
  });

  test('a user who must change password can only reach the allowed routes until they do', async () => {
    const u = await createUser(t, { roleKey: 'qa_manager', mustChangePassword: true });
    const s = await login(t, u.username);
    const blocked = await call(t, 'GET', '/factories', { token: s.accessToken });
    assert.equal(blocked.status, 403);
    assert.deepEqual(blocked.body.error?.details, { reason: 'MUST_CHANGE_PASSWORD' });
    assert.equal((await call(t, 'GET', '/meta/bootstrap', { token: s.accessToken })).status, 200);

    const weak = await call(t, 'POST', '/auth/change-password', { token: s.accessToken, body: { currentPassword: TEST_PASSWORD, newPassword: 'short' } });
    assert.equal(weak.status, 400);
    const wrong = await call(t, 'POST', '/auth/change-password', { token: s.accessToken, body: { currentPassword: 'nope1234', newPassword: 'NewPass123' } });
    assert.equal(wrong.status, 400);
    const changed = await call(t, 'POST', '/auth/change-password', { token: s.accessToken, body: { currentPassword: TEST_PASSWORD, newPassword: 'NewPass123' } });
    assert.equal(changed.status, 200);
    assert.equal((await call(t, 'GET', '/factories', { token: s.accessToken })).status, 200);
  });

  test('responses carry a request id and security headers', async () => {
    const res = await fetch(`${t.url}/health`);
    assert.match(res.headers.get('x-request-id') ?? '', /^[0-9a-f-]{36}$/);
    assert.match(res.headers.get('content-security-policy') ?? '', /frame-ancestors 'none'/);
    assert.equal(res.headers.get('x-frame-options'), 'DENY');
  });
});
