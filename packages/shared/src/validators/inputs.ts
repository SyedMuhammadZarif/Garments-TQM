import { LINE_TYPES, SHELLS, STAGES } from '../constants/enums.js';
import {
  arrayOf, bool, int, nullable, object, oneOf, optional, refine, str, timeOfDay, uuid, type Infer, type Validator,
} from './core.js';
import { passwordProblem, PASSWORD_MAX } from './password.js';

// Named input validators, one per endpoint (SPEC §9.4). The API's validate middleware and the web forms both use these.

const password: Validator<string> = refine(str({ min: 1, max: PASSWORD_MAX, trim: false }), (v) => {
  const problem = passwordProblem(v);
  return problem ? { path: '', code: 'password_policy', message: problem } : null;
});
const version = int({ min: 1 });
const deviceId = str({ min: 1, max: 100 });
const optText = (max: number) => optional(nullable(str({ max })));
const code = (max: number) => str({ min: 1, max, pattern: /^[A-Za-z0-9][A-Za-z0-9_.-]*$/ });

export const loginInput = object({ username: str({ min: 1, max: 100 }), password: str({ min: 1, max: 200, trim: false }), deviceId });
export const refreshInput = object({ refreshToken: str({ min: 1, max: 200 }), deviceId });
export const logoutInput = object({ refreshToken: str({ min: 1, max: 200 }) });
export const changePasswordInput = refine(
  object({ currentPassword: str({ min: 1, max: 200, trim: false }), newPassword: password }),
  (v) => (v.newPassword === v.currentPassword ? { path: 'newPassword', code: 'same', message: 'Choose a new password' } : null),
);
export const updateMeInput = object({
  version,
  fullName: optional(str({ min: 1, max: 120 })),
  phone: optText(30),
  preferredShell: optional(nullable(oneOf(SHELLS))),
});

export const scopeInput = object({
  factoryId: uuid(),
  unitId: nullable(uuid()),
  stage: nullable(oneOf(STAGES)),
  buyerId: nullable(uuid()),
});

export const createUserInput = object({
  id: uuid(),
  username: str({ min: 3, max: 50, pattern: /^[A-Za-z0-9][A-Za-z0-9_.-]*$/ }),
  fullName: str({ min: 1, max: 120 }),
  phone: optText(30),
  email: optional(nullable(str({ max: 200, pattern: /^[^@\s]+@[^@\s]+\.[^@\s]+$/ }))),
  preferredShell: optional(nullable(oneOf(SHELLS))),
  /** Optional; when absent the server generates one. Always shown once in the response. */
  temporaryPassword: optional(password),
  roleIds: arrayOf(uuid(), { min: 1, max: 20 }),
  scopes: arrayOf(scopeInput, { max: 50 }),
});
export const updateUserInput = object({
  version,
  fullName: optional(str({ min: 1, max: 120 })),
  phone: optText(30),
  email: optional(nullable(str({ max: 200, pattern: /^[^@\s]+@[^@\s]+\.[^@\s]+$/ }))),
  preferredShell: optional(nullable(oneOf(SHELLS))),
  isActive: optional(bool()),
});
export const setUserRolesInput = object({ roleIds: arrayOf(uuid(), { min: 1, max: 20 }) });
export const setUserScopesInput = object({ scopes: arrayOf(scopeInput, { max: 50 }) });
export const resetPasswordInput = object({ temporaryPassword: optional(password) });

export const createRoleInput = object({
  id: uuid(),
  key: str({ min: 2, max: 40, pattern: /^[a-z][a-z0-9_]*$/ }),
  name: str({ min: 1, max: 80 }),
  defaultShell: oneOf(SHELLS),
});
export const updateRoleInput = object({ version, name: optional(str({ min: 1, max: 80 })), defaultShell: optional(oneOf(SHELLS)) });
export const setRolePermissionsInput = object({ permissions: arrayOf(str({ min: 1, max: 60 }), { max: 200 }) });

const timezone = refine(str({ min: 1, max: 60 }), (v) => {
  try {
    new Intl.DateTimeFormat('en', { timeZone: v });
    return null;
  } catch {
    return { path: '', code: 'timezone', message: 'Unknown time zone' };
  }
});

export const createFactoryInput = object({
  id: uuid(),
  code: str({ min: 2, max: 6, pattern: /^[A-Z0-9]+$/ }),
  name: str({ min: 1, max: 120 }),
  legalName: optText(200),
  timezone: optional(timezone),
  address: optText(500),
});
export const updateFactoryInput = object({
  version,
  name: optional(str({ min: 1, max: 120 })),
  legalName: optText(200),
  timezone: optional(timezone),
  address: optText(500),
});

export const createUnitInput = object({ id: uuid(), factoryId: uuid(), code: code(20), name: str({ min: 1, max: 120 }), address: optText(500) });
export const updateUnitInput = object({ version, code: optional(code(20)), name: optional(str({ min: 1, max: 120 })), address: optText(500) });

export const createLineInput = object({
  id: uuid(),
  unitId: uuid(),
  code: code(20),
  name: str({ min: 1, max: 120 }),
  lineType: oneOf(LINE_TYPES),
  sortOrder: optional(int({ min: 0, max: 10_000 })),
  isActive: optional(bool()),
});
export const updateLineInput = object({
  version,
  code: optional(code(20)),
  name: optional(str({ min: 1, max: 120 })),
  lineType: optional(oneOf(LINE_TYPES)),
  sortOrder: optional(int({ min: 0, max: 10_000 })),
  isActive: optional(bool()),
});

export const createShiftInput = object({
  id: uuid(),
  factoryId: uuid(),
  name: str({ min: 1, max: 60 }),
  startTime: timeOfDay(),
  endTime: timeOfDay(),
});
export const updateShiftInput = object({
  version,
  name: optional(str({ min: 1, max: 60 })),
  startTime: optional(timeOfDay()),
  endTime: optional(timeOfDay()),
});

export const createOperatorInput = object({
  id: uuid(),
  unitId: uuid(),
  lineId: optional(nullable(uuid())),
  code: code(30),
  name: str({ min: 1, max: 120 }),
  skillGrade: optText(20),
  isActive: optional(bool()),
});
export const updateOperatorInput = object({
  version,
  unitId: optional(uuid()),
  lineId: optional(nullable(uuid())),
  code: optional(code(30)),
  name: optional(str({ min: 1, max: 120 })),
  skillGrade: optText(20),
  isActive: optional(bool()),
});
export const importOperatorsInput = object({
  factoryId: uuid(),
  csv: str({ min: 1, max: 2_000_000, trim: false }),
  /** true = validate and preview only; false = write (all-or-nothing). */
  dryRun: bool(),
});

export const listQuery = object({
  q: optional(str({ max: 100 })),
  cursor: optional(str({ max: 300 })),
  limit: optional(int({ min: 1, max: 200 })),
  factoryId: optional(uuid()),
  unitId: optional(uuid()),
  lineId: optional(uuid()),
  active: optional(bool()),
});
export const idParam = object({ id: uuid() });

export type LoginInput = Infer<typeof loginInput>;
export type CreateUserInput = Infer<typeof createUserInput>;
export type UpdateUserInput = Infer<typeof updateUserInput>;
export type ScopeInput = Infer<typeof scopeInput>;
export type ListQuery = Infer<typeof listQuery>;
