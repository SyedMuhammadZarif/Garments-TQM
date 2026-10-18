// Mirrors the PostgreSQL enums in db/migrations/0001_extensions_enums.sql (SPEC §7.2).
export const STAGES = [
  'sample', 'trims', 'fabric', 'cutting', 'fusing', 'printing', 'embroidery', 'washing',
  'sewing', 'finishing', 'packing', 'final_audit', 'fg_shipment', 'qms',
] as const;
export type Stage = (typeof STAGES)[number];

export const SHELLS = ['floor', 'desk'] as const;
export type Shell = (typeof SHELLS)[number];

export const SEVERITIES = ['critical', 'major', 'minor'] as const;
export type Severity = (typeof SEVERITIES)[number];

export const LINE_TYPES = ['sewing', 'finishing', 'cutting', 'packing', 'other'] as const;
export type LineType = (typeof LINE_TYPES)[number];
