import type { CreateUserInput, TemporaryPasswordDto, UpdateUserInput, UserDto, UserScope } from '@tqm/shared';
import { withTx } from '../db/tx.js';
import { AppError, forbidden } from '../lib/errors.js';
import { authCache } from '../lib/authCache.js';
import { decodeCursor, encodeCursor, pageOf } from '../lib/pagination.js';
import { hasFactoryWideScope, scopedFactoryIds } from '../lib/scope.js';
import { temporaryPassword } from '../lib/tokens.js';
import * as usersRepo from '../repos/usersRepo.js';
import * as rolesRepo from '../repos/rolesRepo.js';
import * as orgRepo from '../repos/orgRepo.js';
import * as authRepo from '../repos/authRepo.js';
import { hashPassword } from './authService.js';
import { outOfScope, txCtx, type Actor, type ServiceDeps } from './context.js';

// A factory admin manages users only inside factories where they have factory-wide scope; super admins
// manage everyone. Only super admins can create or edit super admins (SPEC §5.3).

function managedFactoryIds(actor: Actor): string[] | null {
  if (actor.isSuperAdmin) return null;
  return [...new Set(actor.scopes.filter((s) => s.unitId === null).map((s) => s.factoryId))];
}

async function toDto(deps: ServiceDeps, rows: usersRepo.UserRow[]): Promise<UserDto[]> {
  const ids = rows.map((r) => r.id);
  const [roles, scopes] = await Promise.all([usersRepo.roleIdsByUser(deps.pool, ids), usersRepo.scopesByUser(deps.pool, ids)]);
  return rows.map((r) => ({
    id: r.id,
    username: r.username,
    fullName: r.full_name,
    phone: r.phone,
    email: r.email,
    isActive: r.is_active,
    isSuperAdmin: r.is_super_admin,
    mustChangePassword: r.must_change_password,
    preferredShell: r.preferred_shell,
    lastLoginAt: r.last_login_at?.toISOString() ?? null,
    lockedUntil: r.locked_until && r.locked_until.getTime() > Date.now() ? r.locked_until.toISOString() : null,
    version: r.version,
    roleIds: roles.get(r.id) ?? [],
    scopes: scopes.get(r.id) ?? [],
  }));
}

export async function listUsers(
  deps: ServiceDeps,
  actor: Actor,
  q: { q?: string; cursor?: string; limit?: number },
): Promise<{ items: UserDto[]; nextCursor: string | null; limit: number }> {
  const limit = q.limit ?? 50;
  const after = q.cursor ? decodeCursor(q.cursor) : null;
  const rows = await usersRepo.listUsers(deps.pool, {
    factoryIds: scopedFactoryIds(actor),
    q: q.q ?? null,
    afterUsername: after?.sortValue ?? null,
    afterId: after?.id ?? null,
    limit,
  });
  const page = pageOf(rows, limit, (r) => encodeCursor(r.username, r.id));
  return { items: await toDto(deps, page.items), nextCursor: page.nextCursor, limit };
}

async function loadVisibleUser(deps: ServiceDeps, actor: Actor, id: string): Promise<UserDto> {
  const row = await usersRepo.findUser(deps.pool, id);
  if (!row) throw outOfScope('User');
  const [dto] = await toDto(deps, [row]);
  const factories = scopedFactoryIds(actor);
  if (factories && !dto!.scopes.some((s) => factories.includes(s.factoryId))) throw outOfScope('User');
  return dto!;
}

export async function getUser(deps: ServiceDeps, actor: Actor, id: string): Promise<UserDto> {
  return loadVisibleUser(deps, actor, id);
}

async function assertAssignable(deps: ServiceDeps, actor: Actor, roleIds: string[], scopes: UserScope[]): Promise<void> {
  const roles = await rolesRepo.findRolesByIds(deps.pool, roleIds);
  if (roles.length !== new Set(roleIds).size) throw new AppError('VALIDATION_FAILED', 'Unknown role', { issues: [{ path: 'roleIds', code: 'unknown', message: 'Unknown role' }] });
  if (!actor.isSuperAdmin && roles.some((r) => r.key === 'super_admin')) throw forbidden('Only a super admin can assign the Super Admin role');

  for (const [i, s] of scopes.entries()) {
    if (!hasFactoryWideScope(actor, s.factoryId)) throw forbidden('You can only assign scopes in factories you manage');
    if (s.unitId) {
      const unit = await orgRepo.findUnit(deps.pool, s.unitId);
      if (!unit || unit.factoryId !== s.factoryId) {
        throw new AppError('VALIDATION_FAILED', 'Unit does not belong to the factory', {
          issues: [{ path: `scopes.${i}.unitId`, code: 'mismatch', message: 'Unit does not belong to the factory' }],
        });
      }
    }
  }
}

export async function createUser(deps: ServiceDeps, actor: Actor, input: CreateUserInput): Promise<TemporaryPasswordDto> {
  if (!actor.isSuperAdmin && input.scopes.length === 0) {
    throw new AppError('VALIDATION_FAILED', 'Give the user access to at least one factory', {
      issues: [{ path: 'scopes', code: 'required', message: 'Add at least one scope' }],
    });
  }
  await assertAssignable(deps, actor, input.roleIds, input.scopes);
  const password = input.temporaryPassword ?? temporaryPassword();
  const passwordHash = await hashPassword(deps.config, password);
  await withTx(deps.pool, txCtx(actor), async (tx) => {
    await usersRepo.insertUser(tx, {
      id: input.id,
      username: input.username,
      fullName: input.fullName,
      phone: input.phone ?? null,
      email: input.email ?? null,
      preferredShell: input.preferredShell ?? null,
      passwordHash,
      isSuperAdmin: false,
      createdBy: actor.userId,
    });
    await usersRepo.replaceRoles(tx, input.id, input.roleIds);
    await usersRepo.replaceScopes(tx, input.id, input.scopes, null);
  });
  return { user: await getUser(deps, actor, input.id), temporaryPassword: password };
}

function assertCanEdit(actor: Actor, target: UserDto): void {
  if (target.isSuperAdmin && !actor.isSuperAdmin) throw forbidden('Only a super admin can change a super admin');
}

export async function updateUser(deps: ServiceDeps, actor: Actor, id: string, input: UpdateUserInput): Promise<UserDto> {
  const target = await loadVisibleUser(deps, actor, id);
  assertCanEdit(actor, target);
  if (input.isActive === false && id === actor.userId) throw forbidden('You cannot deactivate your own account');
  const { version, ...patch } = input;
  await withTx(deps.pool, txCtx(actor), async (tx) => {
    await usersRepo.updateUser(tx, id, version, actor.userId, patch);
    if (input.isActive === false) await authRepo.revokeAllUserTokens(tx, id);
  });
  authCache.invalidate(id);
  return getUser(deps, actor, id);
}

export async function deactivateUser(deps: ServiceDeps, actor: Actor, id: string, version: number): Promise<UserDto> {
  return updateUser(deps, actor, id, { version, isActive: false });
}

export async function setRoles(deps: ServiceDeps, actor: Actor, id: string, roleIds: string[]): Promise<UserDto> {
  const target = await loadVisibleUser(deps, actor, id);
  assertCanEdit(actor, target);
  await assertAssignable(deps, actor, roleIds, []);
  await withTx(deps.pool, txCtx(actor), async (tx) => {
    await usersRepo.replaceRoles(tx, id, roleIds);
    await usersRepo.bumpVersion(tx, id, actor.userId);
  });
  authCache.invalidate(id);
  return getUser(deps, actor, id);
}

export async function setScopes(deps: ServiceDeps, actor: Actor, id: string, scopes: UserScope[]): Promise<UserDto> {
  const target = await loadVisibleUser(deps, actor, id);
  assertCanEdit(actor, target);
  await assertAssignable(deps, actor, target.roleIds, scopes);
  await withTx(deps.pool, txCtx(actor), async (tx) => {
    // A factory admin replaces only the scopes inside their own factories; others are preserved.
    await usersRepo.replaceScopes(tx, id, scopes, managedFactoryIds(actor));
    await usersRepo.bumpVersion(tx, id, actor.userId);
  });
  authCache.invalidate(id);
  return getUser(deps, actor, id);
}

export async function resetPassword(deps: ServiceDeps, actor: Actor, id: string, chosen: string | undefined): Promise<TemporaryPasswordDto> {
  const target = await loadVisibleUser(deps, actor, id);
  assertCanEdit(actor, target);
  const password = chosen ?? temporaryPassword();
  const hash = await hashPassword(deps.config, password);
  await withTx(deps.pool, txCtx(actor), async (tx) => {
    await usersRepo.setPassword(tx, id, hash, true, actor.userId);
    await authRepo.revokeAllUserTokens(tx, id);
  });
  authCache.invalidate(id);
  return { user: await getUser(deps, actor, id), temporaryPassword: password };
}

export async function updateMe(
  deps: ServiceDeps,
  actor: Actor,
  input: { version: number; fullName?: string; phone?: string | null; preferredShell?: 'floor' | 'desk' | null },
): Promise<void> {
  const { version, ...patch } = input;
  if (patch.preferredShell === 'floor' && !actor.isSuperAdmin && !actor.permissions.has('inspections.create') && !actor.permissions.has('qms.lab.manage')) {
    throw forbidden('The Floor shell is for users who capture inspections');
  }
  await withTx(deps.pool, txCtx(actor), (tx) => usersRepo.updateUser(tx, actor.userId, version, actor.userId, patch));
}
