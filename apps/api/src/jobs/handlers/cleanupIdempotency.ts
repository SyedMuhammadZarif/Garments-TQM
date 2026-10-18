import { logger } from '../../lib/logger.js';
import * as idempotencyRepo from '../../repos/idempotencyRepo.js';
import type { JobContext } from './index.js';

export async function cleanupIdempotency({ pool }: JobContext): Promise<void> {
  const removed = await idempotencyRepo.deleteOlderThan(pool, 48);
  if (removed) logger.info('idempotency keys cleaned', { removed });
}
