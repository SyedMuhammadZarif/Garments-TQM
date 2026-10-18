import type { PermissionKey } from '../constants/permissions.js';
import type { Shell, Stage } from '../constants/enums.js';
import type { FactorySettings } from '../constants/settings.js';
import type { FactoryDto, LineDto, ShiftDto, UnitDto } from './org.js';

export type UserScope = {
  id?: string;
  factoryId: string;
  unitId: string | null;
  stage: Stage | null;
  buyerId: string | null;
};

export type RoleRef = { id: string; key: string; name: string; defaultShell: Shell };

export type MeDto = {
  id: string;
  username: string;
  fullName: string;
  phone: string | null;
  email: string | null;
  preferredShell: Shell | null;
  mustChangePassword: boolean;
  isSuperAdmin: boolean;
  version: number;
  roles: RoleRef[];
};

export type LoginResponse = {
  accessToken: string;
  refreshToken: string;
  expiresInSec: number;
  user: MeDto;
  mustChangePassword: boolean;
};

export type TokenPair = { accessToken: string; refreshToken: string; expiresInSec: number };

export type BootstrapDto = {
  appName: string;
  user: MeDto;
  permissions: PermissionKey[];
  scopes: UserScope[];
  /** Shell from the user's preference, else their roles' default. */
  shell: Shell;
  /** True if the user may use the Floor shell at all (SPEC §5.5). */
  floorAllowed: boolean;
  factories: (FactoryDto & { settings: FactorySettings })[];
  units: UnitDto[];
  lines: LineDto[];
  shifts: ShiftDto[];
};
