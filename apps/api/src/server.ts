import { ConfigError, loadConfig } from './config.js';
import { createPool } from './db/pool.js';
import { createApp } from './app.js';

function log(level: string, msg: string, extra: Record<string, unknown> = {}): void {
  console.log(JSON.stringify({ time: new Date().toISOString(), level, msg, ...extra }));
}

function main(): void {
  let config;
  try {
    config = loadConfig();
  } catch (err) {
    if (err instanceof ConfigError) {
      console.error(err.message);
      process.exit(1);
    }
    throw err;
  }

  const pool = createPool(config.databaseUrl);
  const app = createApp({ pool });
  const server = app.listen(config.port, () => {
    log('info', 'api listening', { port: config.port, env: config.nodeEnv });
  });

  let shuttingDown = false;
  const shutdown = (signal: string): void => {
    if (shuttingDown) return;
    shuttingDown = true;
    log('info', 'shutting down', { signal });
    // Give in-flight requests up to 30 s (SPEC §12.1), then force exit.
    const force = setTimeout(() => process.exit(1), 30_000);
    force.unref();
    server.close(() => {
      pool
        .end()
        .catch(() => undefined)
        .finally(() => process.exit(0));
    });
    server.closeIdleConnections();
  };
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

main();
