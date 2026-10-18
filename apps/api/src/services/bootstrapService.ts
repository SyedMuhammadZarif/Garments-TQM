import { PERMISSION_KEYS, type BootstrapDto, type Shell } from '@tqm/shared';
import * as orgRepo from '../repos/orgRepo.js';
import { getMe } from './authService.js';
import { listFactories } from './orgService.js';
import type { Actor, ServiceDeps } from './context.js';

/**
 * Shell choice (SPEC §5.5): the user's preference, else Desk if any of their roles defaults to Desk, else Floor.
 * Floor is only offered to users who capture data (inspections.create or qms.lab.manage).
 */
export function resolveShell(preferred: Shell | null, roleShells: Shell[], floorAllowed: boolean): Shell {
  const wanted = preferred ?? (roleShells.includes('desk') || roleShells.length === 0 ? 'desk' : 'floor');
  return wanted === 'floor' && !floorAllowed ? 'desk' : wanted;
}

export async function bootstrap(deps: ServiceDeps, actor: Actor): Promise<BootstrapDto> {
  const me = await getMe(deps.pool, actor.userId);
  const permissions = actor.isSuperAdmin ? null : [...actor.permissions];
  const allPermissions = permissions ?? PERMISSION_KEYS;
  const floorAllowed = allPermissions.includes('inspections.create') || allPermissions.includes('qms.lab.manage');
  const [factories, units, lines, shifts] = await Promise.all([
    listFactories(deps, actor),
    orgRepo.listUnits(deps.pool, actor),
    orgRepo.listLines(deps.pool, actor),
    orgRepo.listShifts(deps.pool, actor),
  ]);
  return {
    appName: deps.config.appName,
    user: me,
    permissions: [...allPermissions],
    scopes: [...actor.scopes],
    shell: resolveShell(me.preferredShell, me.roles.map((r) => r.defaultShell), floorAllowed),
    floorAllowed,
    factories,
    units,
    lines,
    shifts,
  };
}
