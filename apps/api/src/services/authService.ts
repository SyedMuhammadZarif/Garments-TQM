import { randomUUID } from 'node:crypto';
import bcrypt from 'bcrypt';
import type pg from 'pg';
import type { LoginInput, LoginResponse, MeDto, TokenPair } from '@tqm/shared';
import type { Config } from '../config.js';
import { AppError } from '../lib/errors.js';
import { hashToken, newRefreshToken, signAccessToken } from '../lib/tokens.js';
import { authCache } from '../lib/authCache.js';
import { withTx } from '../db/tx.js';
import * as authRepo from '../repos/authRepo.js';
import * as usersRepo from '../repos/usersRepo.js';

// SPEC §11 login protection.
const MAX_USER_FAILURES = 5;
const LOCK_MINUTES = 15;
const MAX_IP_FAILURES = 30;
const IP_WINDOW_MINUTES = 15;
const INVALID = 'Invalid username or password';

// Compared against when the username does not exist, so response time does not reveal valid usernames.
let dummyHash: string | null = null;
async function getDummyHash(rounds: number): Promise<string> {
  dummyHash ??= await bcrypt.hash('not-a-real-password-1', rounds);
  return dummyHash;
}

export type AuthDeps = { pool: pg.Pool; config: Config };

export async function login(
  { pool, config }: AuthDeps,
  input: LoginInput,
  meta: { ip: string | null; userAgent: string | null; requestId: string },
): Promise<LoginResponse> {
  if (meta.ip && (await authRepo.countRecentFailuresByIp(pool, meta.ip, IP_WINDOW_MINUTES)) >= MAX_IP_FAILURES) {
    throw new AppError('RATE_LIMITED', 'Too many failed attempts from this network. Try again in 15 minutes.');
  }

  const user = await authRepo.findUserForLogin(pool, input.username);
  const usable = user && user.is_active && !user.deleted_at;
  const locked = user?.locked_until ? user.locked_until.getTime() > Date.now() : false;
  const passwordOk = await bcrypt.compare(input.password, usable ? user.password_hash : await getDummyHash(config.bcryptRounds));

  if (!usable || locked || !passwordOk) {
    await withTx(pool, { userId: null, requestId: meta.requestId }, async (tx) => {
      await authRepo.recordLoginAttempt(tx, input.username, meta.ip, false);
      if (usable && !locked) await authRepo.markLoginFailure(tx, user.id, MAX_USER_FAILURES, LOCK_MINUTES);
    });
    throw new AppError('UNAUTHENTICATED', INVALID);
  }

  const familyId = randomUUID();
  const refreshToken = newRefreshToken();
  await withTx(pool, { userId: user.id, requestId: meta.requestId }, async (tx) => {
    await authRepo.recordLoginAttempt(tx, input.username, meta.ip, true);
    await authRepo.markLoginSuccess(tx, user.id);
    await authRepo.insertRefreshToken(tx, {
      userId: user.id,
      familyId,
      tokenHash: hashToken(refreshToken),
      deviceId: input.deviceId,
      userAgent: meta.userAgent,
      ttlDays: config.refreshTokenTtlDays,
    });
  });

  const me = await getMe(pool, user.id);
  return {
    accessToken: signAccessToken({ sub: user.id, sid: familyId }, config.jwtSecret, config.accessTokenTtlSec),
    refreshToken,
    expiresInSec: config.accessTokenTtlSec,
    user: me,
    mustChangePassword: me.mustChangePassword,
  };
}

/**
 * Rotates a refresh token. Presenting an already-revoked token means it was stolen or replayed, so every
 * token of that user on that device is revoked (SPEC §11).
 */
export async function refresh(
  { pool, config }: AuthDeps,
  input: { refreshToken: string; deviceId: string },
  meta: { userAgent: string | null; requestId: string },
): Promise<TokenPair> {
  const result = await withTx(pool, { userId: null, requestId: meta.requestId }, async (tx) => {
    const row = await authRepo.findRefreshTokenForUpdate(tx, hashToken(input.refreshToken));
    if (!row) return { error: 'invalid' as const };
    if (row.revoked_at) {
      await authRepo.revokeUserDeviceTokens(tx, row.user_id, row.device_id);
      authCache.invalidate(row.user_id);
      return { error: 'reused' as const };
    }
    if (row.expires_at.getTime() <= Date.now() || row.device_id !== input.deviceId) return { error: 'invalid' as const };
    const subject = await authRepo.loadAuthSubject(tx, row.user_id);
    if (!subject || !subject.user.is_active || subject.user.deleted_at) return { error: 'invalid' as const };

    const next = newRefreshToken();
    const nextId = await authRepo.insertRefreshToken(tx, {
      userId: row.user_id,
      familyId: row.family_id,
      tokenHash: hashToken(next),
      deviceId: row.device_id,
      userAgent: meta.userAgent,
      ttlDays: config.refreshTokenTtlDays,
    });
    await authRepo.revokeRefreshToken(tx, row.id, nextId);
    return { userId: row.user_id, familyId: row.family_id, refreshToken: next };
  });
  if ('error' in result) {
    throw new AppError('UNAUTHENTICATED', result.error === 'reused' ? 'Session ended. Please log in again.' : 'Session expired. Please log in again.');
  }
  return {
    accessToken: signAccessToken({ sub: result.userId, sid: result.familyId }, config.jwtSecret, config.accessTokenTtlSec),
    refreshToken: result.refreshToken,
    expiresInSec: config.accessTokenTtlSec,
  };
}

export async function logout({ pool }: AuthDeps, refreshToken: string, requestId: string): Promise<void> {
  await withTx(pool, { userId: null, requestId }, async (tx) => {
    const row = await authRepo.findRefreshTokenForUpdate(tx, hashToken(refreshToken));
    if (row) {
      await authRepo.revokeRefreshToken(tx, row.id, null);
      authCache.invalidate(row.user_id);
    }
  });
}

export async function changePassword(
  { pool, config }: AuthDeps,
  userId: string,
  input: { currentPassword: string; newPassword: string },
  requestId: string,
): Promise<void> {
  const hash = await usersRepo.getPasswordHash(pool, userId);
  if (!hash || !(await bcrypt.compare(input.currentPassword, hash))) {
    throw new AppError('VALIDATION_FAILED', 'Current password is incorrect', {
      issues: [{ path: 'currentPassword', code: 'incorrect', message: 'Current password is incorrect' }],
    });
  }
  const newHash = await bcrypt.hash(input.newPassword, config.bcryptRounds);
  await withTx(pool, { userId, requestId }, (tx) => usersRepo.setPassword(tx, userId, newHash, false, userId));
  authCache.invalidate(userId);
}

export async function hashPassword(config: Config, password: string): Promise<string> {
  return bcrypt.hash(password, config.bcryptRounds);
}

export async function getMe(db: pg.Pool | pg.PoolClient, userId: string): Promise<MeDto> {
  const row = await usersRepo.findUser(db, userId);
  if (!row) throw new AppError('UNAUTHENTICATED', 'User not found');
  const roles = await authRepo.rolesOfUser(db, userId);
  return {
    id: row.id,
    username: row.username,
    fullName: row.full_name,
    phone: row.phone,
    email: row.email,
    preferredShell: row.preferred_shell,
    mustChangePassword: row.must_change_password,
    isSuperAdmin: row.is_super_admin,
    version: row.version,
    roles: roles.map((r) => ({ id: r.id, key: r.key, name: r.name, defaultShell: r.default_shell })),
  };
}
