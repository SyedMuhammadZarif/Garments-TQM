import { ConfigError, loadConfig } from './config.js';
import { createPool } from './db/pool.js';
import { createApp } from './app.js';
import { setLogLevel, logger } from './lib/logger.js';
import { Worker } from './jobs/worker.js';
import { handlers } from './jobs/handlers/index.js';
import { startScheduler } from './jobs/scheduler.js';

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

  setLogLevel(config.logLevel);
  const pool = createPool(config.databaseUrl);
  const app = createApp({ pool, config });
  const server = app.listen(config.port, () => {
    logger.info('api listening', { port: config.port, env: config.nodeEnv });
  });

  const worker = config.workerEnabled ? new Worker(pool, handlers) : null;
  const stopScheduler = config.workerEnabled ? startScheduler(pool) : () => undefined;
  worker?.start();

  let shuttingDown = false;
  const shutdown = (signal: string): void => {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info('shutting down', { signal });
    stopScheduler();
    // Give in-flight requests up to 30 s (SPEC §12.1), then force exit.
    const force = setTimeout(() => process.exit(1), 30_000);
    force.unref();
    server.close(() => {
      Promise.resolve(worker?.stop())
        .then(() => pool.end())
        .catch(() => undefined)
        .finally(() => process.exit(0));
    });
    server.closeIdleConnections();
  };
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

main();
