import { isPermissionKey, PERMISSIONS, type PermissionDto, type PermissionKey, type RoleDto, type Shell } from '@tqm/shared';
import { withTx } from '../db/tx.js';
import { AppError, forbidden, notFound } from '../lib/errors.js';
import { authCache } from '../lib/authCache.js';
import * as rolesRepo from '../repos/rolesRepo.js';
import { txCtx, type Actor, type ServiceDeps } from './context.js';

const toDto = (r: rolesRepo.RoleRow): RoleDto => ({
  id: r.id,
  key: r.key,
  name: r.name,
  defaultShell: r.default_shell,
  isSystem: r.is_system,
  version: r.version,
  permissions: r.permissions,
  userCount: r.user_count,
});

export function listPermissions(): PermissionDto[] {
  return (Object.entries(PERMISSIONS) as [PermissionKey, { area: string; description: string }][]).map(([key, p]) => ({
    key,
    area: p.area,
    description: p.description,
  }));
}

export async function listRoles(deps: ServiceDeps): Promise<RoleDto[]> {
  return (await rolesRepo.listRoles(deps.pool)).map(toDto);
}

async function getRole(deps: ServiceDeps, id: string): Promise<RoleDto> {
  const row = await rolesRepo.findRole(deps.pool, id);
  if (!row) throw notFound('Role');
  return toDto(row);
}

export async function createRole(deps: ServiceDeps, actor: Actor, input: { id: string; key: string; name: string; defaultShell: Shell }): Promise<RoleDto> {
  await withTx(deps.pool, txCtx(actor), (tx) => rolesRepo.insertRole(tx, { ...input, isSystem: false, userId: actor.userId }));
  return getRole(deps, input.id);
}

export async function updateRole(
  deps: ServiceDeps,
  actor: Actor,
  id: string,
  input: { version: number; name?: string; defaultShell?: Shell },
): Promise<RoleDto> {
  const { version, ...patch } = input;
  await withTx(deps.pool, txCtx(actor), (tx) => rolesRepo.updateRole(tx, id, version, actor.userId, patch));
  authCache.clear();
  return getRole(deps, id);
}

export async function setPermissions(deps: ServiceDeps, actor: Actor, id: string, permissions: string[]): Promise<RoleDto> {
  const role = await getRole(deps, id);
  // Super Admin always holds every permission; editing it could lock everyone out of administration.
  if (role.key === 'super_admin') throw forbidden('The Super Admin role always has every permission');
  const unknown = permissions.filter((p) => !isPermissionKey(p));
  if (unknown.length) {
    throw new AppError('VALIDATION_FAILED', `Unknown permission: ${unknown.join(', ')}`, {
      issues: [{ path: 'permissions', code: 'unknown', message: `Unknown permission: ${unknown.join(', ')}` }],
    });
  }
  await withTx(deps.pool, txCtx(actor), async (tx) => {
    await rolesRepo.replacePermissions(tx, id, [...new Set(permissions)]);
    await rolesRepo.touchRole(tx, id, actor.userId);
  });
  authCache.clear();
  return getRole(deps, id);
}
