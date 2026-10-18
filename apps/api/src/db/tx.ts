import type pg from 'pg';

export type TxContext = { userId: string | null; requestId: string | null };
export type Db = pg.Pool | pg.PoolClient;

// Every write goes through withTx so the audit trigger can attribute the change (SPEC §7.13).
export async function withTx<T>(pool: pg.Pool, ctx: TxContext, fn: (client: pg.PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('begin');
    await client.query("select set_config('app.user_id', $1, true), set_config('app.request_id', $2, true)", [
      ctx.userId ?? '',
      ctx.requestId ?? '',
    ]);
    const result = await fn(client);
    await client.query('commit');
    return result;
  } catch (err) {
    await client.query('rollback').catch(() => undefined);
    throw err;
  } finally {
    client.release();
  }
}
