// SPEC §5.2 (+ reports.ai.generate from spec 1.1). Seeded into the permissions table by seed:base.
export const PERMISSIONS = {
  'org.manage': { area: 'admin', description: 'Factories, units, lines, shifts, operators' },
  'users.manage': { area: 'admin', description: 'Create/edit/deactivate users, reset passwords, assign roles & scopes' },
  'roles.manage': { area: 'admin', description: 'Edit roles and role permissions' },
  'masterdata.manage': { area: 'masterdata', description: 'Buyers, suppliers, styles, orders, measurement specs, buyer quality rules' },
  'templates.manage': { area: 'configuration', description: 'Checklist templates (builder, publish)' },
  'defects.manage': { area: 'configuration', description: 'Defect library' },
  'aql.manage': { area: 'configuration', description: 'AQL tables' },
  'garments.manage': { area: 'configuration', description: 'Garment outline templates' },
  'inspections.create': { area: 'inspections', description: 'Start, capture and submit inspections' },
  'inspections.view': { area: 'inspections', description: 'View inspections in scope' },
  'inspections.approve': { area: 'inspections', description: 'Approve submitted inspections' },
  'inspections.release': { area: 'inspections', description: 'Hold / release lots after AQL' },
  'inspections.reopen': { area: 'inspections', description: 'Reopen a submitted inspection (logged)' },
  'inspections.takeover': { area: 'inspections', description: 'Take over a draft locked by another device' },
  'trace.view': { area: 'traceability', description: 'Traceability timeline and explorer' },
  'labels.manage': { area: 'traceability', description: 'Create roll/bundle/carton codes, print labels' },
  'ncr.create': { area: 'ncr_capa', description: 'Raise NCR' },
  'ncr.manage': { area: 'ncr_capa', description: 'Edit/close/cancel NCR' },
  'capa.manage': { area: 'ncr_capa', description: 'Create/assign/update CAPA and actions' },
  'capa.verify': { area: 'ncr_capa', description: 'Verify CAPA effectiveness' },
  'capa.close': { area: 'ncr_capa', description: 'Close CAPA' },
  'dashboard.view': { area: 'reports', description: 'Command center, heatmap' },
  'reports.view': { area: 'reports', description: 'Reports and inspection lists' },
  'reports.export': { area: 'reports', description: 'CSV export' },
  'reports.ai.generate': { area: 'reports', description: 'Generate AI quality report insights (DeepSeek)' },
  'auditpack.generate': { area: 'reports', description: 'Generate buyer audit packs' },
  'photos.view': { area: 'reports', description: 'Photo wall' },
  'qms.documents.manage': { area: 'qms', description: 'Documents and SOPs' },
  'qms.calibration.manage': { area: 'qms', description: 'Instruments and calibration' },
  'qms.training.manage': { area: 'qms', description: 'Trainings and attendance' },
  'qms.audits.manage': { area: 'qms', description: 'Audits and findings' },
  'qms.claims.manage': { area: 'qms', description: 'Buyer claims' },
  'qms.lab.manage': { area: 'qms', description: 'Lab tests' },
  'qms.view': { area: 'qms', description: 'Read all QMS registers' },
  'archive.manage': { area: 'system', description: 'Retention policy, run/restore archives' },
  'display.manage': { area: 'system', description: 'Wall display tokens' },
  'auditlog.view': { area: 'system', description: 'System audit log' },
  'settings.manage': { area: 'system', description: 'Factory settings, thresholds, escalation rules' },
} as const satisfies Record<string, { area: string; description: string }>;

export type PermissionKey = keyof typeof PERMISSIONS;
export const PERMISSION_KEYS = Object.keys(PERMISSIONS) as PermissionKey[];

export function isPermissionKey(value: string): value is PermissionKey {
  return Object.hasOwn(PERMISSIONS, value);
}
