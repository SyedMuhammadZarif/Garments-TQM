import type { RequestHandler } from 'express';
import type pg from 'pg';
import type { PermissionKey } from '@tqm/shared';
import { AppError } from '../lib/errors.js';
import { verifyAccessToken } from '../lib/tokens.js';
import { authCache, type CachedSubject } from '../lib/authCache.js';
import * as authRepo from '../repos/authRepo.js';

// Paths a user who must change their password may still call (SPEC §5.1).
const ALLOWED_BEFORE_PASSWORD_CHANGE = new Set(['/auth/change-password', '/auth/logout', '/me', '/meta/bootstrap']);

async function loadSubject(pool: pg.Pool, userId: string): Promise<CachedSubject | null> {
  const cached = authCache.get(userId);
  if (cached) return cached;
  const loaded = await authRepo.loadAuthSubject(pool, userId);
  if (!loaded) return null;
  const subject: CachedSubject = {
    userId,
    username: loaded.user.username,
    isActive: loaded.user.is_active && !loaded.user.deleted_at,
    isSuperAdmin: loaded.user.is_super_admin,
    mustChangePassword: loaded.user.must_change_password,
    permissions: new Set(loaded.permissions),
    scopes: loaded.scopes,
    activeFamilies: new Map(),
    loadedAt: Date.now(),
  };
  authCache.set(subject);
  return subject;
}

/** Verifies the Bearer token and attaches req.ctx.auth. Logged-out sessions stop working within 30 s. */
export function authenticate(pool: pg.Pool, jwtSecret: string): RequestHandler {
  return async (req, _res, next) => {
    const header = req.get('authorization');
    const token = header?.startsWith('Bearer ') ? header.slice(7).trim() : null;
    if (!token) throw new AppError('UNAUTHENTICATED', 'Please log in');
    const claims = verifyAccessToken(token, jwtSecret);

    const subject = await loadSubject(pool, claims.sub);
    if (!subject || !subject.isActive) throw new AppError('UNAUTHENTICATED', 'Please log in');
    let familyActive = subject.activeFamilies.get(claims.sid);
    if (familyActive === undefined) {
      familyActive = await authRepo.isFamilyActive(pool, claims.sid);
      subject.activeFamilies.set(claims.sid, familyActive);
    }
    if (!familyActive) throw new AppError('UNAUTHENTICATED', 'Session ended. Please log in again.');

    if (subject.mustChangePassword && !ALLOWED_BEFORE_PASSWORD_CHANGE.has(req.path)) {
      throw new AppError('FORBIDDEN', 'Change your password to continue', { reason: 'MUST_CHANGE_PASSWORD' });
    }

    req.ctx.auth = {
      userId: subject.userId,
      username: subject.username,
      isSuperAdmin: subject.isSuperAdmin,
      mustChangePassword: subject.mustChangePassword,
      sessionId: claims.sid,
      permissions: subject.permissions,
      scopes: subject.scopes,
    };
    next();
  };
}

/** Requires every listed permission. Super admins hold all permissions through their role. */
export function requirePermission(...keys: PermissionKey[]): RequestHandler {
  return (req, _res, next) => {
    const auth = req.ctx.auth;
    if (!auth) throw new AppError('UNAUTHENTICATED', 'Please log in');
    if (!auth.isSuperAdmin && !keys.every((k) => auth.permissions.has(k))) throw new AppError('FORBIDDEN', 'You do not have permission to do this');
    next();
  };
}
