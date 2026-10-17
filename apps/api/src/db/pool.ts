import pg from 'pg';

// SPEC §22.2: pool size 20, statement timeout 15 s, idle-in-transaction timeout 30 s.
export function createPool(connectionString: string): pg.Pool {
  const pool = new pg.Pool({
    connectionString,
    max: 20,
    statement_timeout: 15_000,
    idle_in_transaction_session_timeout: 30_000,
    connectionTimeoutMillis: 5_000,
  });
  // An idle client losing its connection must not crash the process; the pool replaces it.
  pool.on('error', (err) => {
    console.error(
      JSON.stringify({
        time: new Date().toISOString(),
        level: 'error',
        msg: 'pg pool error',
        err: err.message,
      }),
    );
  });
  return pool;
}
