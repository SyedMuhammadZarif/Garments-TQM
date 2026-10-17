import { test } from 'node:test';
import assert from 'node:assert/strict';
import en from './en.json' with { type: 'json' };

test('no message in en.json is empty', () => {
  for (const [key, value] of Object.entries(en)) {
    assert.ok(value.trim().length > 0, key);
  }
});
