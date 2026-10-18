import type { Shell, UserScope } from '@tqm/shared';
import type { Db } from '../db/tx.js';
import { updateVersioned } from '../lib/sql.js';

export type UserRow = {
  id: string;
  username: string;
  full_name: string;
  phone: string | null;
  email: string | null;
  is_active: boolean;
  is_super_admin: boolean;
  must_change_password: boolean;
  preferred_shell: Shell | null;
  last_login_at: Date | null;
  locked_until: Date | null;
  version: number;
};

const USER_COLS = `id, username::text, full_name, phone, email::text, is_active, is_super_admin, must_change_password,
  preferred_shell, last_login_at, locked_until, version`;

export async function findUser(db: Db, id: string): Promise<UserRow | null> {
  const { rows } = await db.query<UserRow>(`select ${USER_COLS} from users where id = $1 and deleted_at is null`, [id]);
  return rows[0] ?? null;
}

export async function getPasswordHash(db: Db, id: string): Promise<string | null> {
  const { rows } = await db.query<{ password_hash: string }>('select password_hash from users where id = $1', [id]);
  return rows[0]?.password_hash ?? null;
}

export async function setPassword(db: Db, id: string, hash: string, mustChange: boolean, byUserId: string): Promise<void> {
  await db.query(
    `update users set password_hash = $2, must_change_password = $3, failed_login_count = 0, locked_until = null,
            version = version + 1, updated_by = $4 where id = $1`,
    [id, hash, mustChange, byUserId],
  );
}

/**
 * Users visible to an admin: those with a scope in one of `factoryIds` (null = all users, super admin).
 * Sorted by username for the admin table.
 */
export async function listUsers(
  db: Db,
  opts: { factoryIds: string[] | null; q: string | null; afterUsername: string | null; afterId: string | null; limit: number },
): Promise<UserRow[]> {
  const { rows } = await db.query<UserRow>(
    `select ${USER_COLS} from users u
      where u.deleted_at is null
        and ($1::uuid[] is null or exists (select 1 from user_scopes s where s.user_id = u.id and s.factory_id = any($1)))
        and ($2::text is null or u.username ilike '%' || $2 || '%' or u.full_name ilike '%' || $2 || '%')
        and ($3::text is null or (u.username::text, u.id) > ($3, $4::uuid))
      order by u.username::text, u.id
      limit $5`,
    [opts.factoryIds, opts.q, opts.afterUsername, opts.afterId, opts.limit + 1],
  );
  return rows;
}

export async function roleIdsByUser(db: Db, userIds: string[]): Promise<Map<string, string[]>> {
  const { rows } = await db.query<{ user_id: string; role_id: string }>(
    'select user_id, role_id from user_roles where user_id = any($1)',
    [userIds],
  );
  const map = new Map<string, string[]>();
  for (const r of rows) map.set(r.user_id, [...(map.get(r.user_id) ?? []), r.role_id]);
  return map;
}

export async function scopesByUser(db: Db, userIds: string[]): Promise<Map<string, UserScope[]>> {
  const { rows } = await db.query<{ id: string; user_id: string; factory_id: string; unit_id: string | null; stage: UserScope['stage']; buyer_id: string | null }>(
    'select id, user_id, factory_id, unit_id, stage, buyer_id from user_scopes where user_id = any($1) order by factory_id, unit_id nulls first',
    [userIds],
  );
  const map = new Map<string, UserScope[]>();
  for (const r of rows) {
    const scope: UserScope = { id: r.id, factoryId: r.factory_id, unitId: r.unit_id, stage: r.stage, buyerId: r.buyer_id };
    map.set(r.user_id, [...(map.get(r.user_id) ?? []), scope]);
  }
  return map;
}

export async function insertUser(
  db: Db,
  u: { id: string; username: string; fullName: string; phone: string | null; email: string | null; preferredShell: Shell | null; passwordHash: string; isSuperAdmin: boolean; createdBy: string | null },
): Promise<void> {
  await db.query(
    `insert into users (id, username, full_name, phone, email, preferred_shell, password_hash, must_change_password,
                        is_super_admin, created_by, updated_by)
     values ($1, $2, $3, $4, $5, $6, $7, true, $8, $9, $9)`,
    [u.id, u.username, u.fullName, u.phone, u.email, u.preferredShell, u.passwordHash, u.isSuperAdmin, u.createdBy],
  );
}

export async function updateUser(
  db: Db,
  id: string,
  version: number,
  userId: string,
  patch: Record<string, unknown>,
): Promise<UserRow> {
  return updateVersioned<UserRow>(db, 'users', {
    id,
    version,
    userId,
    patch,
    returning: USER_COLS,
    columns: { fullName: 'full_name', phone: 'phone', email: 'email', preferredShell: 'preferred_shell', isActive: 'is_active' },
  });
}

export async function replaceRoles(db: Db, userId: string, roleIds: string[]): Promise<void> {
  await db.query('delete from user_roles where user_id = $1', [userId]);
  await db.query('insert into user_roles (user_id, role_id) select $1, unnest($2::uuid[])', [userId, roleIds]);
}

/** Replaces scopes, but only inside `factoryIds` when given (a factory admin cannot touch other factories). */
export async function replaceScopes(db: Db, userId: string, scopes: UserScope[], factoryIds: string[] | null): Promise<void> {
  await db.query('delete from user_scopes where user_id = $1 and ($2::uuid[] is null or factory_id = any($2))', [userId, factoryIds]);
  for (const s of scopes) {
    await db.query('insert into user_scopes (user_id, factory_id, unit_id, stage, buyer_id) values ($1, $2, $3, $4, $5)', [
      userId,
      s.factoryId,
      s.unitId,
      s.stage,
      s.buyerId,
    ]);
  }
}

export async function bumpVersion(db: Db, userId: string, byUserId: string): Promise<void> {
  await db.query('update users set version = version + 1, updated_by = $2 where id = $1', [userId, byUserId]);
}

export async function countUsers(db: Db): Promise<number> {
  const { rows } = await db.query<{ n: number }>('select count(*)::int as n from users');
  return rows[0]?.n ?? 0;
}
