import type { PermissionKey, Shell } from '@tqm/shared';
import type { Db } from '../db/tx.js';
import { updateVersioned } from '../lib/sql.js';

export type RoleRow = {
  id: string;
  key: string;
  name: string;
  default_shell: Shell;
  is_system: boolean;
  version: number;
  permissions: PermissionKey[];
  user_count: number;
};

const ROLE_SELECT = `select r.id, r.key, r.name, r.default_shell, r.is_system, r.version,
    coalesce((select array_agg(rp.permission_key order by rp.permission_key) from role_permissions rp where rp.role_id = r.id), '{}') as permissions,
    (select count(*)::int from user_roles ur where ur.role_id = r.id) as user_count
  from roles r`;

export async function listRoles(db: Db): Promise<RoleRow[]> {
  const { rows } = await db.query<RoleRow>(`${ROLE_SELECT} where r.deleted_at is null order by r.is_system desc, r.name`);
  return rows;
}

export async function findRole(db: Db, id: string): Promise<RoleRow | null> {
  const { rows } = await db.query<RoleRow>(`${ROLE_SELECT} where r.id = $1 and r.deleted_at is null`, [id]);
  return rows[0] ?? null;
}

export async function findRolesByIds(db: Db, ids: string[]): Promise<{ id: string; key: string }[]> {
  const { rows } = await db.query<{ id: string; key: string }>('select id, key from roles where id = any($1) and deleted_at is null', [ids]);
  return rows;
}

export async function insertRole(db: Db, r: { id: string; key: string; name: string; defaultShell: Shell; isSystem: boolean; userId: string | null }): Promise<void> {
  await db.query(
    `insert into roles (id, key, name, default_shell, is_system, created_by, updated_by) values ($1, $2, $3, $4, $5, $6, $6)`,
    [r.id, r.key, r.name, r.defaultShell, r.isSystem, r.userId],
  );
}

export async function updateRole(db: Db, id: string, version: number, userId: string, patch: Record<string, unknown>): Promise<void> {
  await updateVersioned(db, 'roles', {
    id,
    version,
    userId,
    patch,
    returning: 'id',
    columns: { name: 'name', defaultShell: 'default_shell' },
  });
}

export async function replacePermissions(db: Db, roleId: string, permissions: string[]): Promise<void> {
  await db.query('delete from role_permissions where role_id = $1', [roleId]);
  await db.query('insert into role_permissions (role_id, permission_key) select $1, unnest($2::text[])', [roleId, permissions]);
}

export async function touchRole(db: Db, roleId: string, userId: string): Promise<void> {
  await db.query('update roles set version = version + 1, updated_by = $2 where id = $1', [roleId, userId]);
}
