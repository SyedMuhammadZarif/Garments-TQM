import type { LineType, Shell } from '../constants/enums.js';
import type { PermissionKey } from '../constants/permissions.js';
import type { FactorySettings } from '../constants/settings.js';
import type { UserScope } from './auth.js';

export type FactoryDto = {
  id: string;
  code: string;
  name: string;
  legalName: string | null;
  timezone: string;
  address: string | null;
  version: number;
};

export type FactoryWithSettingsDto = FactoryDto & { settings: FactorySettings };

export type UnitDto = { id: string; factoryId: string; code: string; name: string; address: string | null; version: number };

export type LineDto = {
  id: string;
  factoryId: string;
  unitId: string;
  code: string;
  name: string;
  lineType: LineType;
  sortOrder: number;
  isActive: boolean;
  version: number;
};

export type ShiftDto = {
  id: string;
  factoryId: string;
  name: string;
  startTime: string;
  endTime: string;
  crossesMidnight: boolean;
  version: number;
};

export type OperatorDto = {
  id: string;
  factoryId: string;
  unitId: string;
  lineId: string | null;
  code: string;
  name: string;
  skillGrade: string | null;
  isActive: boolean;
  version: number;
};

export type OperatorImportRow = {
  row: number;
  code: string;
  name: string;
  unitCode: string;
  lineCode: string | null;
  skillGrade: string | null;
  action: 'create' | 'update' | 'error';
  errors: string[];
};

export type OperatorImportResult = { rows: OperatorImportRow[]; created: number; updated: number; committed: boolean };

export type UserDto = {
  id: string;
  username: string;
  fullName: string;
  phone: string | null;
  email: string | null;
  isActive: boolean;
  isSuperAdmin: boolean;
  mustChangePassword: boolean;
  preferredShell: Shell | null;
  lastLoginAt: string | null;
  lockedUntil: string | null;
  version: number;
  roleIds: string[];
  scopes: UserScope[];
};

/** Returned once when a user is created or a password is reset; never retrievable again. */
export type TemporaryPasswordDto = { user: UserDto; temporaryPassword: string };

export type RoleDto = {
  id: string;
  key: string;
  name: string;
  defaultShell: Shell;
  isSystem: boolean;
  version: number;
  permissions: PermissionKey[];
  userCount: number;
};

export type PermissionDto = { key: PermissionKey; description: string; area: string };

export type ListMeta = { nextCursor: string | null; limit: number };
