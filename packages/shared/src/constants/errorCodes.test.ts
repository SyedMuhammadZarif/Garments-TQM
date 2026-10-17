import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ERROR_CODES } from './errorCodes.js';

test('every error code maps to a 4xx/5xx status', () => {
  for (const [code, status] of Object.entries(ERROR_CODES)) {
    assert.ok(status >= 400 && status < 600, `${code} -> ${status}`);
  }
});

test('OUT_OF_SCOPE never reveals existence (404)', () => {
  assert.equal(ERROR_CODES.OUT_OF_SCOPE, 404);
});
