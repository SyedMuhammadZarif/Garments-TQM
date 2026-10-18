import type { PermissionKey, Shell, Stage, UserScope } from '@tqm/shared';
import type { Db } from '../db/tx.js';

export type UserAuthRow = {
  id: string;
  username: string;
  password_hash: string;
  is_active: boolean;
  is_super_admin: boolean;
  must_change_password: boolean;
  failed_login_count: number;
  locked_until: Date | null;
  deleted_at: Date | null;
};

export async function findUserForLogin(db: Db, username: string): Promise<UserAuthRow | null> {
  const { rows } = await db.query<UserAuthRow>(
    `select id, username::text, password_hash, is_active, is_super_admin, must_change_password,
            failed_login_count, locked_until, deleted_at
       from users where username = $1`,
    [username],
  );
  return rows[0] ?? null;
}

export async function recordLoginAttempt(db: Db, username: string, ip: string | null, success: boolean): Promise<void> {
  await db.query('insert into login_attempts (username, ip, success) values ($1, $2, $3)', [username, ip, success]);
}

export async function countRecentFailuresByIp(db: Db, ip: string, minutes: number): Promise<number> {
  const { rows } = await db.query<{ n: number }>(
    `select count(*)::int as n from login_attempts
      where ip = $1 and not success and at > now() - make_interval(mins => $2)`,
    [ip, minutes],
  );
  return rows[0]?.n ?? 0;
}

export async function markLoginFailure(db: Db, userId: string, maxFailures: number, lockMinutes: number): Promise<void> {
  // Counting and locking in one statement avoids races between parallel attempts.
  await db.query(
    `update users set
        failed_login_count = case when failed_login_count + 1 >= $2 then 0 else failed_login_count + 1 end,
        locked_until = case when failed_login_count + 1 >= $2 then now() + make_interval(mins => $3) else locked_until end
      where id = $1`,
    [userId, maxFailures, lockMinutes],
  );
}

export async function markLoginSuccess(db: Db, userId: string): Promise<void> {
  await db.query('update users set failed_login_count = 0, locked_until = null, last_login_at = now() where id = $1', [userId]);
}

export type RefreshTokenRow = {
  id: string;
  user_id: string;
  family_id: string;
  device_id: string;
  expires_at: Date;
  revoked_at: Date | null;
};

export async function insertRefreshToken(
  db: Db,
  t: { userId: string; familyId: string; tokenHash: string; deviceId: string; userAgent: string | null; ttlDays: number },
): Promise<string> {
  const { rows } = await db.query<{ id: string }>(
    `insert into refresh_tokens (user_id, family_id, token_hash, device_id, user_agent, expires_at)
     values ($1, $2, $3, $4, $5, now() + make_interval(days => $6)) returning id`,
    [t.userId, t.familyId, t.tokenHash, t.deviceId, t.userAgent, t.ttlDays],
  );
  return rows[0]!.id;
}

export async function findRefreshTokenForUpdate(db: Db, tokenHash: string): Promise<RefreshTokenRow | null> {
  const { rows } = await db.query<RefreshTokenRow>(
    `select id, user_id, family_id, device_id, expires_at, revoked_at
       from refresh_tokens where token_hash = $1 for update`,
    [tokenHash],
  );
  return rows[0] ?? null;
}

export async function revokeRefreshToken(db: Db, id: string, replacedBy: string | null): Promise<void> {
  await db.query('update refresh_tokens set revoked_at = coalesce(revoked_at, now()), replaced_by = $2 where id = $1', [
    id,
    replacedBy,
  ]);
}

export async function revokeUserDeviceTokens(db: Db, userId: string, deviceId: string): Promise<void> {
  await db.query(
    'update refresh_tokens set revoked_at = now() where user_id = $1 and device_id = $2 and revoked_at is null',
    [userId, deviceId],
  );
}

export async function revokeAllUserTokens(db: Db, userId: string): Promise<void> {
  await db.query('update refresh_tokens set revoked_at = now() where user_id = $1 and revoked_at is null', [userId]);
}

export async function isFamilyActive(db: Db, familyId: string): Promise<boolean> {
  const { rows } = await db.query<{ ok: boolean }>(
    `select exists(select 1 from refresh_tokens where family_id = $1 and revoked_at is null and expires_at > now()) as ok`,
    [familyId],
  );
  return rows[0]?.ok ?? false;
}

export type AuthSubjectRow = {
  id: string;
  username: string;
  is_active: boolean;
  is_super_admin: boolean;
  must_change_password: boolean;
  deleted_at: Date | null;
};

export async function loadAuthSubject(
  db: Db,
  userId: string,
): Promise<{ user: AuthSubjectRow; permissions: PermissionKey[]; scopes: UserScope[] } | null> {
  const users = await db.query<AuthSubjectRow>(
    'select id, username::text, is_active, is_super_admin, must_change_password, deleted_at from users where id = $1',
    [userId],
  );
  const user = users.rows[0];
  if (!user) return null;
  const perms = await db.query<{ permission_key: PermissionKey }>(
    `select distinct rp.permission_key
       from user_roles ur
       join roles r on r.id = ur.role_id and r.deleted_at is null
       join role_permissions rp on rp.role_id = r.id
      where ur.user_id = $1`,
    [userId],
  );
  const scopes = await db.query<{ id: string; factory_id: string; unit_id: string | null; stage: Stage | null; buyer_id: string | null }>(
    'select id, factory_id, unit_id, stage, buyer_id from user_scopes where user_id = $1 order by factory_id, unit_id nulls first',
    [userId],
  );
  return {
    user,
    permissions: perms.rows.map((r) => r.permission_key),
    scopes: scopes.rows.map((s) => ({ id: s.id, factoryId: s.factory_id, unitId: s.unit_id, stage: s.stage, buyerId: s.buyer_id })),
  };
}

export type RoleRefRow = { id: string; key: string; name: string; default_shell: Shell };

export async function rolesOfUser(db: Db, userId: string): Promise<RoleRefRow[]> {
  const { rows } = await db.query<RoleRefRow>(
    `select r.id, r.key, r.name, r.default_shell from user_roles ur
       join roles r on r.id = ur.role_id and r.deleted_at is null
      where ur.user_id = $1 order by r.name`,
    [userId],
  );
  return rows;
}
