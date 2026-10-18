import { createHash } from 'node:crypto';
import type { RequestHandler } from 'express';
import type pg from 'pg';
import { AppError } from '../lib/errors.js';
import { logger } from '../lib/logger.js';
import * as repo from '../repos/idempotencyRepo.js';

// SPEC §9.6. Mutations carrying an Idempotency-Key run once per (key, user); retries get the stored
// response. 5xx responses are not stored so a retry can succeed later.
const MUTATING = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
const KEY_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const WAIT_MS = 5_000;
const POLL_MS = 100;

/** JSON with sorted object keys, so semantically equal bodies hash the same. */
export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(',')}}`;
  }
  return JSON.stringify(value) ?? 'null';
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export function idempotency(pool: pg.Pool): RequestHandler {
  return async (req, res, next) => {
    const key = req.get('idempotency-key');
    const userId = req.ctx.auth?.userId;
    if (!MUTATING.has(req.method) || !key || !userId) return next();
    if (!KEY_RE.test(key)) throw new AppError('VALIDATION_FAILED', 'Idempotency-Key must be a UUID');

    const path = req.originalUrl.split('?')[0] ?? req.originalUrl;
    const hash = createHash('sha256').update(`${req.method} ${path} ${canonicalJson(req.body ?? null)}`).digest('hex');

    if (!(await repo.claim(pool, { key, userId, method: req.method, path, hash }))) {
      const deadline = Date.now() + WAIT_MS;
      for (;;) {
        const row = await repo.find(pool, key, userId);
        if (row && row.request_hash !== hash) {
          throw new AppError('IDEMPOTENCY_MISMATCH', 'This Idempotency-Key was already used for a different request');
        }
        if (row?.status_code != null) {
          res.setHeader('Idempotent-Replay', 'true');
          if (row.response_body === null) res.status(row.status_code).end();
          else res.status(row.status_code).json(row.response_body);
          return;
        }
        if (!row) {
          // The first attempt failed with a 5xx and released the key; run this one normally.
          if (await repo.claim(pool, { key, userId, method: req.method, path, hash })) break;
          continue;
        }
        if (Date.now() > deadline) throw new AppError('DUPLICATE', 'The same request is still being processed. Try again shortly.');
        await sleep(POLL_MS);
      }
    }

    let captured: unknown;
    const originalJson = res.json.bind(res);
    res.json = (body: unknown) => {
      captured = body;
      return originalJson(body);
    };
    res.on('finish', () => {
      const store = res.statusCode < 500 ? repo.complete(pool, key, userId, res.statusCode, captured) : repo.release(pool, key, userId);
      store.catch((err: unknown) => logger.error('idempotency store failed', { err: String(err), requestId: req.ctx.requestId }));
    });
    // Client disconnected before a response: free the key so the retry can run.
    res.on('close', () => {
      if (!res.writableFinished) repo.release(pool, key, userId).catch(() => undefined);
    });
    next();
  };
}
