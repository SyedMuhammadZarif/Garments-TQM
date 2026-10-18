import { STAGES, SEVERITIES, type Severity, type Stage } from './enums.js';
import { int, num, object, oneOf, optional, refine, str, arrayOf, bool, type Validator } from '../validators/core.js';

// factories.settings JSON (SPEC §7.3.1 + spec 1.1 currency/loss model). Values marked "default — confirm with client"
// in the admin UI are factory-specific and must be reviewed before go-live.
export type FactorySettings = {
  dhu_thresholds: { green_max: number; amber_max: number };
  four_point_default_limit: number;
  tls_round_sample: number;
  measurement_default_tolerance_cm: number;
  stage_labels: { final_audit: string };
  photo_retention_days_after_ship: number;
  archive_target: { type: 'folder'; path: string };
  require_photo_for_severity: Severity[];
  inspection_approval_required: Partial<Record<Stage, boolean>>;
  work_week_start: number;
  currency: string;
  loss_model: { rework_cost_pct: number };
};

export const DEFAULT_FACTORY_SETTINGS: FactorySettings = {
  dhu_thresholds: { green_max: 3.0, amber_max: 5.0 },
  four_point_default_limit: 40,
  tls_round_sample: 7,
  measurement_default_tolerance_cm: 1.0,
  stage_labels: { final_audit: 'Final Audit' },
  photo_retention_days_after_ship: 90,
  archive_target: { type: 'folder', path: '/archive' },
  require_photo_for_severity: ['critical', 'major'],
  inspection_approval_required: { sewing: false, final_audit: true },
  work_week_start: 6,
  currency: 'USD',
  loss_model: { rework_cost_pct: 15 },
};

const approvalShape = Object.fromEntries(STAGES.map((s) => [s, optional(bool())])) as Record<
  Stage,
  Validator<boolean | undefined>
>;

export const factorySettingsInput = object({
  dhu_thresholds: refine(object({ green_max: num({ min: 0, max: 100 }), amber_max: num({ min: 0, max: 100 }) }), (v) =>
    v.amber_max < v.green_max ? { path: 'dhu_thresholds.amber_max', code: 'range', message: 'Must be ≥ green max' } : null,
  ),
  four_point_default_limit: num({ min: 1, max: 200 }),
  tls_round_sample: int({ min: 1, max: 20 }),
  measurement_default_tolerance_cm: num({ min: 0, max: 10 }),
  stage_labels: object({ final_audit: str({ min: 1, max: 40 }) }),
  photo_retention_days_after_ship: int({ min: 7, max: 3650 }),
  archive_target: object({ type: oneOf(['folder'] as const), path: str({ min: 1, max: 300 }) }),
  require_photo_for_severity: arrayOf(oneOf(SEVERITIES), { max: 3 }),
  inspection_approval_required: object(approvalShape),
  work_week_start: int({ min: 0, max: 6 }),
  currency: str({ min: 3, max: 3, pattern: /^[A-Z]{3}$/ }),
  loss_model: object({ rework_cost_pct: num({ min: 0, max: 100 }) }),
});
