import type { Db } from '../db/tx.js';

export type IdempotencyRow = { request_hash: string; status_code: number | null; response_body: unknown };

/** Inserts the placeholder row; false when the key already exists for this user. */
export async function claim(db: Db, k: { key: string; userId: string; method: string; path: string; hash: string }): Promise<boolean> {
  const { rowCount } = await db.query(
    `insert into idempotency_keys (key, user_id, method, path, request_hash) values ($1, $2, $3, $4, $5)
     on conflict do nothing`,
    [k.key, k.userId, k.method, k.path, k.hash],
  );
  return rowCount === 1;
}

export async function find(db: Db, key: string, userId: string): Promise<IdempotencyRow | null> {
  const { rows } = await db.query<IdempotencyRow>(
    'select request_hash, status_code, response_body from idempotency_keys where key = $1 and user_id = $2',
    [key, userId],
  );
  return rows[0] ?? null;
}

export async function complete(db: Db, key: string, userId: string, status: number, body: unknown): Promise<void> {
  await db.query('update idempotency_keys set status_code = $3, response_body = $4 where key = $1 and user_id = $2', [
    key,
    userId,
    status,
    body === undefined ? null : JSON.stringify(body),
  ]);
}

export async function release(db: Db, key: string, userId: string): Promise<void> {
  await db.query('delete from idempotency_keys where key = $1 and user_id = $2 and status_code is null', [key, userId]);
}

export async function deleteOlderThan(db: Db, hours: number): Promise<number> {
  const { rowCount } = await db.query('delete from idempotency_keys where created_at < now() - make_interval(hours => $1)', [hours]);
  return rowCount ?? 0;
}
