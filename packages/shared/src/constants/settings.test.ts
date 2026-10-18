import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_FACTORY_SETTINGS, factorySettingsInput } from './settings.js';
import { PERMISSION_KEYS } from './permissions.js';
import { SEED_ROLES } from './roles.js';

test('default settings pass their own validator', () => {
  assert.equal(factorySettingsInput(DEFAULT_FACTORY_SETTINGS).ok, true);
});

test('amber threshold below green is rejected', () => {
  const r = factorySettingsInput({ ...DEFAULT_FACTORY_SETTINGS, dhu_thresholds: { green_max: 5, amber_max: 3 } });
  assert.equal(r.ok, false);
});

test('seed roles only reference known permissions and have unique keys', () => {
  const keys = new Set<string>();
  for (const role of SEED_ROLES) {
    assert.ok(!keys.has(role.key), role.key);
    keys.add(role.key);
    for (const p of role.permissions) assert.ok(PERMISSION_KEYS.includes(p), `${role.key}: ${p}`);
  }
  assert.equal(SEED_ROLES.length, 10);
});

test('QA manager cannot manage org, users, roles or settings', () => {
  const qa = SEED_ROLES.find((r) => r.key === 'qa_manager');
  assert.ok(qa);
  for (const p of ['org.manage', 'users.manage', 'roles.manage', 'settings.manage'] as const) {
    assert.ok(!qa.permissions.includes(p), p);
  }
  assert.ok(qa.permissions.includes('capa.close'));
});
