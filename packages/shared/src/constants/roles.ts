import { PERMISSION_KEYS, type PermissionKey } from './permissions.js';
import type { Shell } from './enums.js';

// SPEC §5.3 seed roles. Admins can edit them later; seed:base only inserts missing roles and never
// overwrites permissions an admin has changed.
export type SeedRole = { key: string; name: string; defaultShell: Shell; permissions: readonly PermissionKey[] };

const ADMIN_ONLY: readonly PermissionKey[] = ['org.manage', 'users.manage', 'roles.manage', 'settings.manage'];

export const SEED_ROLES: readonly SeedRole[] = [
  // Super Admin also has users.is_super_admin = true to bypass scope; the role carries every permission.
  { key: 'super_admin', name: 'Super Admin', defaultShell: 'desk', permissions: PERMISSION_KEYS },
  { key: 'factory_admin', name: 'Factory Admin', defaultShell: 'desk', permissions: PERMISSION_KEYS },
  {
    key: 'qa_manager',
    name: 'QA Manager',
    defaultShell: 'desk',
    permissions: PERMISSION_KEYS.filter((p) => !ADMIN_ONLY.includes(p)),
  },
  {
    key: 'qa_executive',
    name: 'QA Executive / Auditor',
    defaultShell: 'floor',
    permissions: [
      'inspections.create', 'inspections.view', 'inspections.approve', 'inspections.release', 'inspections.reopen',
      'inspections.takeover', 'ncr.create', 'capa.manage', 'trace.view', 'labels.manage', 'photos.view', 'reports.view',
    ],
  },
  {
    key: 'line_qc_inspector',
    name: 'Line QC Inspector',
    defaultShell: 'floor',
    permissions: ['inspections.create', 'inspections.view', 'trace.view', 'ncr.create'],
  },
  {
    key: 'supervisor',
    name: 'Supervisor',
    defaultShell: 'floor',
    permissions: [
      'inspections.create', 'inspections.view', 'inspections.approve', 'ncr.create', 'capa.manage', 'trace.view',
      'dashboard.view',
    ],
  },
  {
    key: 'production_manager',
    name: 'Production Manager',
    defaultShell: 'desk',
    permissions: ['dashboard.view', 'reports.view', 'inspections.view', 'capa.manage', 'trace.view', 'photos.view'],
  },
  {
    key: 'management',
    name: 'Management (GM/Owner)',
    defaultShell: 'desk',
    permissions: [
      'dashboard.view', 'reports.view', 'reports.export', 'trace.view', 'photos.view', 'qms.view', 'auditpack.generate',
    ],
  },
  {
    key: 'merchandiser',
    name: 'Merchandiser',
    defaultShell: 'desk',
    permissions: ['inspections.view', 'trace.view', 'reports.view', 'auditpack.generate'],
  },
  {
    key: 'lab_technician',
    name: 'Lab Technician',
    defaultShell: 'floor',
    permissions: ['qms.lab.manage', 'qms.calibration.manage', 'inspections.view'],
  },
];
