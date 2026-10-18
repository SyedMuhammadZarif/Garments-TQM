import type pg from 'pg';
import type { Config } from '../config.js';
import type { AuthContext } from '../types.js';
import { AppError } from '../lib/errors.js';
import type { TxContext } from '../db/tx.js';

// What every service call needs: the pool, config and who is acting.
export type ServiceDeps = { pool: pg.Pool; config: Config };
export type Actor = AuthContext & { requestId: string };

export function txCtx(actor: Actor): TxContext {
  return { userId: actor.userId, requestId: actor.requestId };
}

/** Records outside the actor's scope look exactly like missing ones (SPEC §9.3 OUT_OF_SCOPE = 404). */
export function outOfScope(what = 'Record'): AppError {
  return new AppError('OUT_OF_SCOPE', `${what} not found`);
}
