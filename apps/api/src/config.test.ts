import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ConfigError, loadConfig } from './config.js';

const valid = {
  DATABASE_URL: 'postgres://tqm:tqm@localhost:5432/tqm',
  JWT_SECRET: 'x'.repeat(32),
};

test('loads with only required vars and applies defaults', () => {
  const config = loadConfig(valid);
  assert.equal(config.port, 4000);
  assert.equal(config.appName, 'Novabe Garments TQM');
  assert.equal(config.workerEnabled, true);
  assert.equal(config.deepseek.apiKey, null);
});

test('reports every problem at once', () => {
  assert.throws(
    () => loadConfig({ PORT: 'abc', NODE_ENV: 'staging' }),
    (err: unknown) => {
      assert.ok(err instanceof ConfigError);
      assert.equal(err.problems.length, 4);
      assert.match(err.message, /DATABASE_URL is required/);
      assert.match(err.message, /JWT_SECRET is required/);
      assert.match(err.message, /PORT must be an integer/);
      assert.match(err.message, /NODE_ENV must be one of/);
      return true;
    },
  );
});

test('rejects a short JWT secret', () => {
  assert.throws(() => loadConfig({ ...valid, JWT_SECRET: 'short' }), /at least 32 bytes/);
});

test('rejects the example JWT secret in production', () => {
  assert.throws(
    () =>
      loadConfig({
        ...valid,
        NODE_ENV: 'production',
        JWT_SECRET: 'change-me-to-32+-random-bytes-xxxxxxxxxx',
      }),
    /example value/,
  );
});

test('rejects a non-postgres DATABASE_URL', () => {
  assert.throws(() => loadConfig({ ...valid, DATABASE_URL: 'mysql://x@y/z' }), /DATABASE_URL must use/);
});

test('rejects invalid booleans', () => {
  assert.throws(
    () => loadConfig({ ...valid, WORKER_ENABLED: 'yes' }),
    /WORKER_ENABLED must be true or false/,
  );
});
