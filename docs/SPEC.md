# Garments TQM Platform — Complete Build Specification

Version 1.1 · Source of truth for implementation · Place this file at `docs/SPEC.md`

> **Changes in 1.1 (decided with the client, 2026-10-17)**
> - **English only.** The whole app, seed data and demo data are built in English. Bengali may be added later as a
>   language option; to keep that cheap, every UI string still goes through `t()` with keys in `i18n/en.json`. No
>   `*_bn` columns, no `bn` labels, no Bengali fonts in Phase A.
> - **Branding:** product name default `APP_NAME=Novabe Garments TQM`; visual style follows the mockups in `docs/ui/`.
> - **Cost per piece:** every QC check (inspection) is created for a garment type (shirt, pant, jacket, …) and the user
>   must enter the cost per piece before the check is created. Stored on the inspection and used for loss estimates
>   (see §18.9).
> - **AI Quality Report** (§18.9) is added as a showcase feature, powered by the DeepSeek API, built in Milestone 10b.
>   The Buyer Audit Pack (§18.8) is still built (Milestone 13).
> - **Command Center KPIs** follow the mockup where it adds value (see §18.5).

---

## Table of contents

1. Product summary
2. Technology stack and dependency rules
3. Architecture principles (online-first, offline-ready)
4. Repository structure
5. Users, roles, permissions and data scope
6. Domain model overview
7. Database schema (complete)
8. Business rules and calculations
9. API design conventions
10. API endpoint catalogue
11. Authentication and security
12. Background jobs, events and live updates
13. Files, photos, retention and archiving
14. Frontend architecture
15. Design system
16. Floor shell (phone/tablet) — screens
17. Desk shell (PC) — screens
18. The 8 showcase features — detailed specs
19. Department modules (14) — detailed specs
20. Seed data and demo data
21. Milestones, build order and acceptance criteria
22. Testing, performance and operations
23. Out of scope (do not build now) and Phase B notes
24. Open questions — make configurable, never guess

---

## 1. Product summary

A web platform that replaces paper-based quality control in garment factories. It covers the full lifecycle
from sample approval to finished-goods shipment.

**Two kinds of users, one app:**

- **Floor users** (line QC inspectors, stage inspectors, supervisors) on Android tablets/phones. They CAPTURE data:
  inspections, defects, photos, measurements, scans.
- **Desk users** (QA managers, QA executives, production managers, management, merchandisers, admins) on PCs.
  They VIEW, ANALYZE and CONFIGURE: dashboards, reports, CAPA, traceability, QMS records, templates, users.

**Delivery model:**

- **Now (Phase A):** a responsive web app, online-only, with resilient drafts so no work is ever lost.
- **Later (Phase B, not now):** the same code wrapped as an installable app (Capacitor) with offline capture and sync.
- **Fallback:** if the app misbehaves, users open the same system in the browser.

**Product name:** configurable via `APP_NAME` env var (default: `Garments TQM`). Factory name and logo come from factory settings.

**Language:** English only in Phase A. All UI text goes through `t()` (`i18n/en.json`) so another language can be
added later without touching screens.

**Timezone:** default `Asia/Dhaka`, configurable per factory. Store all timestamps as `timestamptz` (UTC).
Bucket by day/hour in the factory's local timezone.

---

## 2. Technology stack and dependency rules

### 2.1 Stack

| Layer | Technology |
|---|---|
| Database | PostgreSQL 16 |
| Runtime | Node.js 22 LTS (required: uses `zlib.crc32`, `--env-file`, `node:test`) |
| API | Express 5 + TypeScript |
| Frontend | React 19 + TypeScript + Vite 6 + Tailwind CSS v4 |
| Routing | `react-router` v7 (library mode) |
| Workspaces | npm workspaces (no pnpm/turbo) |
| Reverse proxy | Nginx |
| Packaging | Docker + Docker Compose |

### 2.2 Dependency allowlist

**Runtime dependencies — ONLY these:**

| Package | Where | Purpose |
|---|---|---|
| `express` | api | HTTP server |
| `pg` | api | PostgreSQL driver (raw SQL) |
| `bcrypt` | api | Password hashing |
| `jsonwebtoken` | api | Access tokens |
| `multer` | api | Multipart uploads |
| `react`, `react-dom` | web | UI |
| `react-router` | web | Routing |

**Dev dependencies — ONLY these:**
`typescript`, `tsx`, `vite`, `@vitejs/plugin-react`, `tailwindcss`, `@tailwindcss/vite`, `@types/node`,
`@types/express`, `@types/pg`, `@types/bcrypt`, `@types/jsonwebtoken`, `@types/multer`, `@types/react`,
`@types/react-dom`, `eslint`, `typescript-eslint`, `eslint-plugin-react-hooks`, `prettier`, `concurrently`.

**Requires explicit user approval before adding (ask when you reach it):**

- `qrcode` (server-side QR image generation for labels, Milestone 7). Alternative if refused: implement a QR encoder
  in-house (substantial work) or print codes as Code 128 barcodes generated in SVG in-house.

**Explicitly forbidden (write in-house instead):** ORMs/query builders, Zod/Yup, Redux/Zustand/TanStack, UI kits
(shadcn, MUI…), chart libraries, date libraries, Redis/BullMQ, helmet, cors, dotenv, axios, uuid (use `crypto.randomUUID`),
sharp/jimp, archiver/jszip, socket.io, i18n libraries, testing frameworks other than `node:test`.

### 2.3 Platform APIs used instead of libraries

- IDs: `crypto.randomUUID()` (browser and Node).
- Dates: `Intl.DateTimeFormat`, `Date`; bucketing in SQL with `AT TIME ZONE`.
- Live updates: Server-Sent Events (`EventSource`) + PostgreSQL `LISTEN/NOTIFY`.
- Images: `<canvas>` resize/encode on the client.
- Barcode/QR decoding: `BarcodeDetector` (Chrome Android); keyboard-wedge scanners; manual entry fallback.
- Local persistence: `localStorage` (draft JSON), IndexedDB (pending photo blobs) via a tiny in-house wrapper.
- ZIP archives: in-house minimal ZIP writer (STORE method, CRC32 from `zlib.crc32`).
- PDF: browser print (`window.print()` + `@media print`).
- Excel: CSV export (UTF-8 with BOM so Excel detects the encoding).
- Env vars: `node --env-file=.env`.
- Tests: `node:test` + `node:assert`, run through `tsx`.

---

## 3. Architecture principles (online-first, offline-ready)

The app is online-only in Phase A, but MUST follow these rules so Phase B (offline) only swaps the data layer.

1. **Client-generated UUIDs.** Any record created from the UI (inspection, defect, photo, measurement, NCR, CAPA action,
   comment) gets its `id` from `crypto.randomUUID()` in the browser. The server accepts it (validate UUID v4 format) and
   rejects duplicates idempotently.
2. **Idempotent writes.** Every POST/PUT/PATCH/DELETE accepts an `Idempotency-Key` header (UUID). The server stores the
   key + response for 48 hours and replays the stored response on repeat (see §9.6).
3. **Versioned rows.** Every business table has `version int not null default 1`. Updates must send the version they
   edited; the server performs `UPDATE ... WHERE id = $1 AND version = $2` and returns `409 VERSION_CONFLICT` if 0 rows
   changed. Successful updates increment `version`.
4. **Soft deletes.** `deleted_at timestamptz null`. Never hard-delete business data. All reads filter `deleted_at is null`
   unless explicitly requesting deleted rows.
5. **Change tracking.** Every business table has `updated_at` (set by trigger). This later powers `GET /sync/pull?since=`.
6. **Single data access layer in the frontend.** `apps/web/src/data/dataSource.ts` exposes typed functions
   (e.g. `inspections.saveDraft(...)`). Screens and hooks call only these functions. Today they call the API through
   `apiClient`. In Phase B an offline implementation replaces them without touching screens.
7. **Versioned master data.** Checklist templates are versioned and immutable once published. Inspections store the
   `template_version_id` they used. Defect codes are never deleted, only deactivated.
8. **Server-assigned human references.** Records have a UUID `id` (client) and a human `ref_no` (e.g. `INS-DA-26-000123`)
   assigned by the server when the record is first persisted/submitted. UI shows `ref_no` when present, otherwise
   "Draft".
9. **Server is authoritative for calculations.** The client previews AQL verdict, DHU, tolerances using the same
   `packages/shared` functions, but the server recomputes and stores the official result.

---

## 4. Repository structure

```
/
├─ CLAUDE.md
├─ package.json                  # npm workspaces root + scripts
├─ tsconfig.base.json            # strict settings shared by all
├─ eslint.config.js
├─ .prettierrc
├─ .env.example
├─ apps/
│  ├─ api/
│  │  ├─ package.json
│  │  ├─ tsconfig.json
│  │  └─ src/
│  │     ├─ server.ts            # creates app, starts HTTP + worker + LISTEN
│  │     ├─ app.ts               # express app factory (used by tests)
│  │     ├─ config.ts            # reads & validates env vars, fails fast
│  │     ├─ db/
│  │     │  ├─ pool.ts           # pg Pool
│  │     │  ├─ tx.ts             # withTx(), sets app.user_id / app.request_id
│  │     │  └─ listen.ts         # dedicated LISTEN client, reconnects
│  │     ├─ middleware/
│  │     │  ├─ requestId.ts
│  │     │  ├─ securityHeaders.ts
│  │     │  ├─ cors.ts
│  │     │  ├─ auth.ts           # verifies Bearer JWT, loads user + scopes
│  │     │  ├─ requirePermission.ts
│  │     │  ├─ idempotency.ts
│  │     │  ├─ rateLimit.ts      # in-house, Postgres-backed for login
│  │     │  ├─ validate.ts       # runs shared validators on body/query/params
│  │     │  └─ errorHandler.ts
│  │     ├─ routes/              # one file per area, thin
│  │     ├─ services/            # business logic per area
│  │     ├─ repos/               # SQL per area (no SQL outside repos/)
│  │     ├─ jobs/
│  │     │  ├─ worker.ts         # polling loop, SKIP LOCKED
│  │     │  ├─ scheduler.ts      # enqueues recurring jobs
│  │     │  └─ handlers/         # one file per job type
│  │     ├─ events/
│  │     │  ├─ publish.ts        # pg_notify wrapper
│  │     │  └─ sse.ts            # SSE hub, ticket auth, heartbeats
│  │     ├─ files/
│  │     │  ├─ storage.ts        # paths, writes, magic-byte checks
│  │     │  └─ zip.ts            # minimal ZIP writer
│  │     └─ lib/                 # errors, pagination, refNo, csv, logger, time
│  └─ web/
│     ├─ package.json
│     ├─ tsconfig.json
│     ├─ vite.config.ts
│     ├─ index.html
│     ├─ public/
│     │  ├─ manifest.webmanifest
│     │  └─ icons/
│     └─ src/
│        ├─ main.tsx
│        ├─ app/                 # router, providers, guards, shell selection
│        ├─ shells/
│        │  ├─ FloorLayout.tsx
│        │  └─ DeskLayout.tsx
│        ├─ features/            # one folder per feature area
│        │  ├─ auth/ inspections/ capture/ scan/ drafts/ alerts/
│        │  ├─ dashboard/ lines/ trace/ photos/ ncr/ capa/
│        │  ├─ orders/ reports/ qms/ admin/ display/ print/
│        ├─ components/          # design-system components (§15)
│        ├─ charts/              # in-house SVG charts
│        ├─ data/
│        │  ├─ apiClient.ts      # fetch wrapper, auth refresh, idempotency, errors
│        │  ├─ dataSource.ts     # the ONLY data API screens use
│        │  ├─ useQuery.ts       # tiny cache + refetch hook
│        │  ├─ useMutation.ts
│        │  └─ sse.ts            # EventSource with ticket + reconnect
│        ├─ drafts/              # autosave engine, localStorage mirror
│        ├─ uploads/             # photo queue, IndexedDB wrapper, compression
│        ├─ i18n/                # en.json, useT()
│        ├─ hooks/               # useBreakpoint, useOnline, useBackGuard...
│        └─ styles/              # tailwind entry, theme tokens, print.css
├─ packages/
│  └─ shared/
│     ├─ package.json
│     └─ src/
│        ├─ types/               # DTOs shared by api and web
│        ├─ validators/          # hand-written validators (§9.4)
│        ├─ calc/                # aql.ts, dhu.ts, fourPoint.ts, tolerance.ts, zones.ts
│        ├─ constants/           # stages, statuses, permissions, error codes
│        └─ template/            # checklist template schema types + validation
├─ db/
│  ├─ migrations/                # 0001_extensions.sql, 0002_org.sql, ...
│  ├─ functions/                 # trigger functions (included by migrations)
│  └─ seed/
│     ├─ base/                   # roles, permissions, defects, AQL, garment SVGs
│     ├─ demo/                   # demo generator
│     └─ photos/                 # optional sample defect photos (user-provided)
├─ scripts/
│  ├─ migrate.ts
│  ├─ reset.ts
│  └─ loadtest.ts
├─ deploy/
│  ├─ docker-compose.yml
│  ├─ api.Dockerfile
│  ├─ web.Dockerfile             # builds web, copies into nginx image
│  ├─ nginx.conf
│  └─ backup.sh
└─ docs/
   ├─ SPEC.md
   ├─ PROGRESS.md
   └─ DECISIONS.md
```

**TypeScript config:** `strict`, `noUncheckedIndexedAccess`, `noImplicitOverride`, `exactOptionalPropertyTypes`,
`verbatimModuleSyntax`. `packages/shared` is consumed via workspace path (`"@tqm/shared": "*"`), compiled by Vite on the
web side and by `tsx`/`tsc` on the API side.

---

## 5. Users, roles, permissions and data scope

### 5.1 Login identity

Factory staff often have no email. Users log in with **username** (usually employee ID) + password.
Phone and email are optional profile fields. Admins create users and set a temporary password; the user must change it
on first login (`must_change_password = true`).

### 5.2 Permission keys (seed all of these)

```
org.manage                 factories, units, lines, shifts, operators
users.manage               create/edit/deactivate users, reset passwords, assign roles & scopes
roles.manage               edit roles and role permissions
masterdata.manage          buyers, suppliers, styles, orders, measurement specs, buyer quality rules
templates.manage           checklist templates (builder, publish)
defects.manage             defect library
aql.manage                 AQL tables
garments.manage            garment outline templates
inspections.create         start/capture/submit inspections
inspections.view           view inspections in scope
inspections.approve        supervisor/QA approval of submitted inspections
inspections.release        hold / release lots after AQL
inspections.reopen         reopen a submitted inspection (logged)
inspections.takeover       take over a draft locked by another device
trace.view                 traceability timeline and explorer
labels.manage              create rolls/bundles/cartons codes, print labels
ncr.create                 raise NCR
ncr.manage                 edit/close/cancel NCR
capa.manage                create/assign/update CAPA and actions
capa.verify                verify effectiveness
capa.close                 close CAPA
dashboard.view             command center, heatmap
reports.view               reports and inspection lists
reports.export             CSV export
auditpack.generate         generate buyer audit packs
reports.ai.generate        generate AI quality report insights (DeepSeek)
photos.view                photo wall
qms.documents.manage
qms.calibration.manage
qms.training.manage
qms.audits.manage
qms.claims.manage
qms.lab.manage
qms.view                   read all QMS registers
archive.manage             retention policy, run/restore archives
display.manage             wall display tokens
auditlog.view              system audit log
settings.manage            factory settings, thresholds, escalation rules
```

### 5.3 Seed roles (editable by admins)

| Role | Default shell | Permissions (summary) |
|---|---|---|
| Super Admin | Desk | everything, all factories |
| Factory Admin | Desk | everything within assigned factory |
| QA Manager | Desk | all except org/users/roles/settings; includes capa.close, capa.verify, inspections.release, archive.manage |
| QA Executive / Auditor | Floor (switchable) | inspections.*, ncr.create, capa.manage, trace.view, labels.manage, photos.view, reports.view |
| Line QC Inspector | Floor | inspections.create, inspections.view (own), trace.view, ncr.create |
| Supervisor | Floor | inspections.create/view/approve, ncr.create, capa.manage (own items), trace.view, dashboard.view |
| Production Manager | Desk | dashboard.view, reports.view, inspections.view, capa.manage, trace.view, photos.view |
| Management (GM/Owner) | Desk | read-only: dashboard.view, reports.view, reports.export, trace.view, photos.view, qms.view, auditpack.generate |
| Merchandiser | Desk | read-only for orders of assigned buyers: inspections.view, trace.view, reports.view, auditpack.generate |
| Lab Technician | Floor | qms.lab.manage, qms.calibration.manage, inspections.view |

### 5.4 Data scope

A user has one or more scopes: `(factory_id, unit_id nullable, stage nullable, buyer_id nullable)`.

- `unit_id null` = all units of that factory.
- `stage null` = all stages.
- `buyer_id` is used for merchandisers (only their buyers' orders).
- Super Admin bypasses scope.

Every repo query that returns factory data MUST apply scope through a shared helper
`scopeClause(user, alias)` that returns a SQL fragment + params. Never filter scope only on the client.
Write tests proving a user cannot read another unit's inspections by ID.

### 5.5 Shell selection

- Each role has `default_shell` (`floor` | `desk`). User may override (`users.preferred_shell`).
- On viewport `< 1024px`, Desk-default users still get the Desk shell but in responsive mode; a toggle in the profile menu
  switches shells for that session.
- Floor shell is only offered to users with `inspections.create` or `qms.lab.manage`.

---

## 6. Domain model overview

```
Factory ─< Unit ─< Line
Factory ─< Shift, Operator, User(scopes)
Buyer ─< Style ─< Order ─< OrderBreakdown(color,size,qty)
Style ─< StyleMeasurement(point,size,spec,tol)
Buyer ─< BuyerQualityRule(stage → AQL levels, tolerances, 4-point limit)

Traceability chain (trace_links parent → child):
Supplier → FabricRoll / TrimsBatch → CuttingLay → Bundle → (Line, sewing) → Carton → Shipment

Inspection (stage, type, template version, subject, order, line...)
  ├─< Defect (code, severity, qty, operator, x/y/zone, photo)
  ├─< Measurement (point, size, value, within tolerance)
  ├─< Photo
  └─ answers (JSONB per template version)

NCR (from inspection / audit / claim / manual) ─1 CAPA ─< CapaAction, CapaComment
QMS: Documents/Revisions, Instruments/Calibrations, Trainings/Attendance, Audits/Findings, Claims, LabTests
Stats: line_hourly_stats, line_hourly_defects, daily_quality_stats, defect_daily_stats
System: audit_log, jobs, idempotency_keys, notifications, report_snapshots, archives, display_tokens
```

**Stages (enum `stage`), exactly these 14:**
`sample`, `trims`, `fabric`, `cutting`, `fusing`, `printing`, `embroidery`, `washing`, `sewing`, `finishing`,
`packing`, `final_audit`, `fg_shipment`, `qms`.

**Inspection types (enum `inspection_type`):**
`sample_review`, `incoming`, `four_point`, `shade`, `lab`, `marker`, `spreading`, `bundle_audit`, `process_check`,
`inline`, `endline`, `measurement`, `metal_detection`, `carton_audit`, `aql_final`, `pre_final`, `loading`, `stock_qc`,
`re_inspection`, `generic`.
Each stage allows a subset (defined in `packages/shared/src/constants/stages.ts`, see §19).

> Module 12 naming ("CTP / Cut-to-Pack / Final Audit") is unresolved with the client. Implement as stage `final_audit`
> with display name configurable per factory (`settings.stage_labels.final_audit`). Default label: "Final Audit".

---

## 7. Database schema (complete)

### 7.1 Conventions

- Schema: `public`. Extensions: `pgcrypto`, `citext`, `pg_trgm`.
- **Standard columns** on every business table (written below as `+STD`):
  ```sql
  id          uuid primary key,                -- client- or server-generated
  factory_id  uuid not null references factories(id),   -- omit only on global tables (noted)
  version     integer not null default 1,
  created_at  timestamptz not null default now(),
  created_by  uuid references users(id),
  updated_at  timestamptz not null default now(),
  updated_by  uuid references users(id),
  deleted_at  timestamptz
  ```
- Trigger `set_updated_at()` on every `+STD` table.
- Trigger `audit_row()` on every `+STD` table (writes `audit_log`, see §7.12).
- Every foreign key column gets an index. Every `+STD` table gets `(factory_id, updated_at)` index for future sync.
- Enums are PostgreSQL enums created in `0001`. Adding values later uses `ALTER TYPE ... ADD VALUE`.
- Money is not part of this system except claims (`numeric(14,2)` + `currency char(3)`).
- Text search: `pg_trgm` GIN indexes on `ref_no`, `orders.order_no`, `styles.style_no`, `codes.code`.

### 7.2 Enums

```sql
create type stage as enum ('sample','trims','fabric','cutting','fusing','printing','embroidery','washing',
  'sewing','finishing','packing','final_audit','fg_shipment','qms');
create type inspection_type as enum (... as listed in §6 ...);
create type inspection_status as enum ('draft','submitted','approved','rejected','on_hold','released','cancelled');
create type inspection_result as enum ('pass','fail','conditional','na');
create type severity as enum ('critical','major','minor');
create type shell as enum ('floor','desk');
create type ncr_status as enum ('open','closed','cancelled');
create type capa_status as enum ('open','investigating','action','verification','closed');
create type entity_type as enum ('fabric_roll','trims_batch','cutting_lay','bundle','line_output','carton','shipment','order','sample');
create type job_status as enum ('queued','running','done','failed','dead');
create type photo_state as enum ('hot','archived');
create type archive_status as enum ('pending','writing','verifying','complete','failed','restored');
create type doc_status as enum ('draft','approved','obsolete');
create type audit_type as enum ('internal','buyer','third_party','certification');
create type claim_status as enum ('received','investigating','accepted','rejected','settled');
```

### 7.3 Organization

```
factories (global, no factory_id)
  id uuid pk, code text unique (2–6 chars, used in ref_no), name text, legal_name text,
  timezone text default 'Asia/Dhaka', logo_path text, address text,
  settings jsonb not null default '{}'   -- see §7.3.1
  + version/created/updated/deleted

units          +STD   code text, name text, address text           unique(factory_id, code)
lines          +STD   unit_id uuid, code text, name text, line_type text ('sewing','finishing','cutting','packing','other'),
                      sort_order int, is_active bool default true    unique(unit_id, code)
shifts         +STD   name text, start_time time, end_time time, crosses_midnight bool
operators      +STD   unit_id uuid, line_id uuid null, code text (employee no), name text,
                      skill_grade text, is_active bool               unique(factory_id, code)
```

#### 7.3.1 `factories.settings` JSON (validated by shared validator)

```json
{
  "dhu_thresholds": { "green_max": 3.0, "amber_max": 5.0 },
  "four_point_default_limit": 40,
  "tls_round_sample": 7,
  "measurement_default_tolerance_cm": 1.0,
  "stage_labels": { "final_audit": "Final Audit" },
  "photo_retention_days_after_ship": 90,
  "archive_target": { "type": "folder", "path": "/archive" },
  "require_photo_for_severity": ["critical", "major"],
  "inspection_approval_required": { "sewing": false, "final_audit": true },
  "work_week_start": 6,
  "currency": "USD",
  "loss_model": { "rework_cost_pct": 15 }
}
```

### 7.4 Users and access

```
users (global; factory membership via user_scopes)
  id uuid pk, username citext unique, full_name text, phone text, email citext,
  password_hash text, must_change_password bool default true, locale text default 'en' (only 'en' in Phase A),
  preferred_shell shell null, is_active bool default true, is_super_admin bool default false,
  last_login_at timestamptz, avatar_path text, failed_login_count int default 0, locked_until timestamptz
  + version/created/updated/deleted

roles (global)        id, key text unique, name text, default_shell shell, is_system bool
permissions (global)  key text pk, description text, area text
role_permissions      role_id, permission_key   pk(role_id, permission_key)
user_roles            user_id, role_id          pk(user_id, role_id)
user_scopes           id, user_id, factory_id, unit_id null, stage stage null, buyer_id null
refresh_tokens        id uuid pk, user_id, token_hash text (sha256), device_id text, user_agent text,
                      created_at, expires_at, revoked_at, replaced_by uuid
login_attempts        id bigserial, username citext, ip inet, success bool, at timestamptz
```

### 7.5 Master data

```
buyers               +STD  code text, name text, is_active bool         unique(factory_id, code)
buyer_quality_rules  +STD  buyer_id, stage stage, inspection_type inspection_type null,
                           inspection_level text default 'II', aql_critical numeric(4,2) default 0,
                           aql_major numeric(4,2) default 2.5, aql_minor numeric(4,2) default 4.0,
                           four_point_limit numeric(5,1) null, measurement_tolerance_cm numeric(4,2) null,
                           notes text                                   unique(buyer_id, stage, inspection_type)
suppliers            +STD  code, name, supplier_type text ('fabric','trims','wash','print','embroidery','other'), is_active
styles               +STD  buyer_id, style_no text, description text, garment_type text (fk garment_templates.garment_type),
                           season text, product_category text            unique(factory_id, buyer_id, style_no)
style_measurements   +STD  style_id, point_code text, point_name text, size text,
                           spec_value numeric(7,2), tol_plus numeric(5,2), tol_minus numeric(5,2), unit text ('cm'|'inch'),
                           sort_order int                                unique(style_id, point_code, size)
orders               +STD  order_no text (PO), buyer_id, style_id, quantity int, ship_date date, status text
                           ('open','in_production','shipped','closed','cancelled'), shipped_at timestamptz
                                                                         unique(factory_id, order_no)
order_breakdown      +STD  order_id, color text, size text, quantity int unique(order_id, color, size)
```

### 7.6 Traceability

```
fabric_rolls   +STD  order_id null, supplier_id, roll_no text, lot_no text, shade text, width_in numeric(6,2),
                     length_yd numeric(8,2), weight_kg numeric(8,2), received_at timestamptz, status text
                     ('received','inspected','approved','rejected','consumed')
trims_batches  +STD  order_id null, supplier_id, trim_type text, description text, batch_no text, quantity int,
                     unit text, received_at, status
cutting_lays   +STD  order_id, lay_no text, marker_no text, color text, plies int, marker_length_yd numeric,
                     cut_at timestamptz, cutting_table text
bundles        +STD  order_id, cutting_lay_id, bundle_no text, color text, size text, quantity int,
                     line_id null (assigned sewing line), status text
cartons        +STD  order_id, carton_no text, assortment jsonb ([{color,size,qty}]), quantity int,
                     gross_kg numeric, net_kg numeric, status text ('packed','audited','held','shipped')
shipments      +STD  order_id, shipment_no text, container_no text, seal_no text, vessel text, etd date,
                     loaded_at timestamptz, status
codes          +STD  code text unique (globally), entity_type entity_type, entity_id uuid,
                     printed_at timestamptz, print_count int default 0
trace_links    +STD  parent_type entity_type, parent_id uuid, child_type entity_type, child_id uuid,
                     quantity numeric null                               unique(parent_type,parent_id,child_type,child_id)
```

**Code format:** `{PREFIX}-{base32 8 chars}` where prefix ∈ `FR` (fabric roll), `TB` (trims), `CL` (cutting lay),
`BN` (bundle), `CT` (carton), `SH` (shipment), `OR` (order). Crockford base32 (no I, L, O, U) generated from random bytes,
retry on collision. Codes are case-insensitive on lookup.

### 7.7 Configuration

```
checklist_templates          +STD  stage stage, inspection_type inspection_type, name text,
                                   buyer_id null (null = all buyers), current_version_id uuid null, is_active bool
checklist_template_versions  +STD  template_id, version_no int, schema jsonb (§8.9), published_at timestamptz null,
                                   published_by uuid null, change_note text   unique(template_id, version_no)
                                   -- once published_at is set: immutable (enforced by trigger raising exception)
defect_codes                 (factory_id NULL = global library row; factory rows can add their own)
                             id, factory_id null, code text, name text, category text,
                             stages stage[] , default_severity severity, sort_order int, is_active bool, +version/timestamps
                                   unique(coalesce(factory_id,'00000000-0000-0000-0000-000000000000'), code)
garment_templates            (global) garment_type text pk, name, view_box text,
                             views jsonb  -- { "front": { "svg": "<path d=...>", "zones": [...] }, "back": {...} }
aql_code_letters             (global) inspection_level text, lot_min int, lot_max int (null = infinity), code_letter char(1)
aql_plans                    (global) code_letter char(1), aql numeric(4,2), sample_size int, accept int, reject int
                                   pk(code_letter, aql)  -- arrows already resolved, see §8.1
escalation_rules             +STD  level int, after_hours_overdue int, notify_role_id uuid, also_notify_owner_manager bool
display_tokens               +STD  label text, unit_id null, token_hash text, last_seen_at timestamptz, revoked_at timestamptz
ref_counters                 factory_id, ref_type text, year int, last_value int   pk(factory_id, ref_type, year)
```

### 7.8 Inspections

```
inspections  +STD
  ref_no text null unique,              -- assigned on first submit: INS-{FACTORYCODE}-{YY}-{000001}
  unit_id uuid, line_id uuid null, stage stage, inspection_type inspection_type,
  template_version_id uuid,
  buyer_id null, style_id null, order_id null, color text null, size text null,
  subject_type entity_type null, subject_id uuid null,      -- roll, bundle, carton, shipment...
  garment_type text not null references garment_templates(garment_type),  -- chosen when the check is created
  cost_per_piece numeric(12,2) not null check (cost_per_piece > 0),       -- entered before the check is created
  currency char(3) not null,                                 -- from factory settings.currency at creation
  operator_id null,                                          -- for inline checks on a specific operator
  shift_id null,
  inspector_id uuid not null,
  parent_inspection_id null,                                 -- re-inspection chain
  status inspection_status not null default 'draft',
  result inspection_result null,
  started_at timestamptz not null, submitted_at timestamptz null,
  approved_by null, approved_at null, rejected_reason text null,
  hold_reason text null, held_by null, held_at null, released_by null, released_at null, release_note text null,
  lot_size int null, sample_size int null,
  pieces_checked int not null default 0,
  defective_pieces int not null default 0,
  defects_total int not null default 0,
  critical_count int not null default 0, major_count int not null default 0, minor_count int not null default 0,
  first_pass_ok int not null default 0,                     -- pieces OK at first check (for FPY/RFT)
  aql_snapshot jsonb null,                                  -- {level, code_letter, sample_size, aql:{critical,major,minor}, ac/re...}
  metrics jsonb not null default '{}',                      -- stage-specific results (e.g. four_point score, TLS colour)
  answers jsonb not null default '{}',                      -- checklist responses keyed by field key
  device_id text null, client_submitted_at timestamptz null,
  notes text null
  indexes: (factory_id, stage, submitted_at desc), (line_id, submitted_at desc), (order_id), (subject_type, subject_id),
           (inspector_id, status), (status) where status in ('draft','on_hold')

inspection_drafts
  inspection_id uuid pk references inspections(id),
  user_id uuid, device_id text,
  payload jsonb not null,                -- full client draft state (§14.6)
  client_updated_at timestamptz not null,
  server_updated_at timestamptz not null default now(),
  lock_device_id text not null, lock_heartbeat_at timestamptz not null

inspection_pieces   +STD  inspection_id, piece_no int, is_defective bool, checked_at timestamptz
                          -- used by endline/AQL capture to count pieces; defects reference piece_no

defects  +STD
  inspection_id, piece_no int null, defect_code_id uuid, severity severity, quantity int default 1,
  operator_id null, view text null ('front'|'back'), x numeric(5,4) null, y numeric(5,4) null, zone text null,
  photo_id uuid null, remark text null, rework_status text default 'open' ('open','reworked','rejected')
  -- fabric 4-point extras (null for others):
  fp_length_in numeric(6,2) null, fp_points int null, fp_yard_position numeric(8,2) null

measurements +STD  inspection_id, piece_no int, point_code text, size text, spec_value numeric, tol_plus numeric,
                   tol_minus numeric, measured_value numeric, deviation numeric, within_tolerance bool
```

### 7.9 Photos and files

```
photos  +STD
  owner_type text ('inspection','defect','ncr','capa','calibration','audit','claim','loading','document'),
  owner_id uuid, inspection_id null, defect_id null,
  path text, thumb_path text, mime text, bytes int, thumb_bytes int, width int, height int, sha256 text,
  -- denormalized filters for the Photo Wall:
  unit_id null, line_id null, stage stage null, defect_code_id null, severity severity null,
  order_id null, style_id null, buyer_id null, taken_at timestamptz,
  state photo_state not null default 'hot', archive_id uuid null, uploaded_at timestamptz
  indexes: (factory_id, taken_at desc, id desc), (defect_code_id, taken_at desc), (line_id, taken_at desc),
           (order_id), (state) where state = 'hot'

files  +STD   owner_type text, owner_id uuid, path text, original_name text, mime text, bytes int, sha256 text
              -- PDFs/certificates/SOP files (documents, calibration certs, audit reports)
```

### 7.10 Live and summary statistics

```
line_hourly_stats   factory_id, unit_id, line_id, stat_date date (factory local), hour smallint (0–23),
                    stage stage, inspection_type inspection_type,
                    checked int, defective int, defects int, first_pass_ok int, updated_at timestamptz
                    pk(line_id, stat_date, hour, stage, inspection_type)

line_hourly_defects factory_id, line_id, stat_date, hour, defect_code_id, count int
                    pk(line_id, stat_date, hour, defect_code_id)

daily_quality_stats factory_id, unit_id, line_id null, buyer_id null, stat_date, stage, inspection_type,
                    inspections int, checked int, defective int, defects int, first_pass_ok int,
                    aql_pass int, aql_fail int, critical int, major int, minor int, refreshed_at
                    unique(factory_id, unit_id, coalesce(line_id, zero_uuid), coalesce(buyer_id, zero_uuid), stat_date, stage, inspection_type)

defect_daily_stats  factory_id, unit_id, line_id null, buyer_id null, stat_date, stage, defect_code_id, count int, refreshed_at
```

- `line_hourly_*` are upserted INSIDE the same transaction as inspection submit (and reversed on reopen/cancel).
- `daily_*` are rebuilt by the `stats.refresh_daily` job (§12).

### 7.11 NCR, CAPA, notifications

```
ncrs  +STD
  ref_no text unique (NCR-{FC}-{YY}-{000001}), source_type text ('inspection','audit','claim','lab','manual'),
  source_id uuid null, title text, description text, severity severity, stage stage null,
  unit_id null, line_id null, order_id null, buyer_id null, raised_by uuid, raised_at timestamptz,
  status ncr_status default 'open', closed_at null, cancel_reason text null

capas  +STD
  ref_no text unique (CAPA-...), ncr_id uuid unique, title text, owner_id uuid, status capa_status default 'open',
  due_at timestamptz, escalation_level int default 0, last_escalated_at null,
  containment text, root_cause text, five_why jsonb default '[]' ([{why, answer}] up to 5),
  corrective_action text, preventive_action text,
  verification_due_at null, verified_by null, verified_at null, effectiveness text ('effective','not_effective') null,
  verification_note text, closed_by null, closed_at null, board_position numeric (ordering within column)

capa_actions   +STD  capa_id, description text, owner_id, due_at, done_at null, done_note text
capa_comments  +STD  capa_id, author_id, body text
notifications  id uuid pk, factory_id, user_id, type text, title text, body text, link text,
               entity_type text, entity_id uuid, created_at, read_at null
               index (user_id, read_at, created_at desc)
```

### 7.12 QMS

```
documents            +STD  doc_no text, title, category text ('sop','policy','work_instruction','form','manual'),
                           department stage null, current_revision_id null, review_due_at date null
document_revisions   +STD  document_id, rev_no text, file_id uuid, change_summary text, status doc_status,
                           approved_by null, approved_at null, effective_date date
instruments          +STD  code text, name text, instrument_type text ('measuring_tape','scale','gsm_cutter','needle_detector',
                           'thermometer','pressure_gauge','light_box','other'), location text, unit_id null,
                           calibration_interval_days int, last_calibrated_at date null, next_due_at date null,
                           status text ('in_service','due','overdue','out_of_service')
calibration_records  +STD  instrument_id, calibrated_at date, performed_by text, external_agency text null,
                           result text ('pass','fail','adjusted'), certificate_file_id null, next_due_at date, notes
trainings            +STD  title, topic text, stage stage null, trainer text, held_at timestamptz, duration_min int
training_attendance  +STD  training_id, user_id null, operator_id null, result text ('attended','passed','failed'), score numeric null
audits               +STD  audit_type audit_type, title, auditor text, auditor_org text, buyer_id null, audit_date date,
                           scope text, score numeric null, rating text null, status text ('planned','in_progress','closed'),
                           report_file_id null
audit_findings       +STD  audit_id, description, severity severity, clause text null, ncr_id null, status text ('open','closed')
claims               +STD  claim_no text, buyer_id, order_id null, received_at date, description, defect_code_id null,
                           quantity int null, amount numeric(14,2) null, currency char(3) null, status claim_status, ncr_id null
lab_tests            +STD  test_type text ('shrinkage','color_fastness_wash','color_fastness_rub','gsm','ph','pilling',
                           'tensile','seam_slippage','bond_strength','print_cure','other'), stage stage,
                           subject_type entity_type null, subject_id uuid null, order_id null, standard text,
                           result_value numeric null, result_unit text null, result_text text null, requirement text,
                           outcome text ('pass','fail'), tested_by uuid, tested_at timestamptz, file_id null
```

### 7.13 System

```
audit_log      id bigserial pk, at timestamptz default now(), factory_id uuid null, user_id uuid null,
               request_id text null, table_name text, row_id uuid, action text ('insert','update','delete','soft_delete'),
               old_data jsonb null, new_data jsonb null, changed_fields text[]
               indexes: (table_name, row_id, at), (user_id, at), (factory_id, at)
               -- append-only: REVOKE UPDATE, DELETE from app role; trigger prevents update/delete.

jobs           id bigserial pk, type text, payload jsonb, run_at timestamptz default now(), priority int default 0,
               status job_status default 'queued', attempts int default 0, max_attempts int default 5,
               locked_at null, locked_by text null, last_error text null, created_at, finished_at null,
               dedupe_key text null unique   -- for recurring jobs
               index (status, run_at, priority desc)

idempotency_keys  key uuid, user_id uuid, method text, path text, request_hash text, status_code int,
                  response_body jsonb, created_at, pk(key, user_id)

report_snapshots  +STD  report_type text ('audit_pack'), order_id null, params jsonb, payload jsonb, sha256 text,
                        generated_by uuid, generated_at timestamptz, title text

archives          +STD  order_id null, period_from date null, period_to date null, target_type text, target_uri text,
                        part_no int, file_name text, bytes bigint, sha256 text, photo_count int,
                        status archive_status, error text null, verified_at null, restored_at null

schema_migrations  version text pk, applied_at timestamptz, checksum text
```

**Audit trigger detail:** `audit_row()` reads `current_setting('app.user_id', true)` and `current_setting('app.request_id', true)`.
`withTx()` executes `select set_config('app.user_id', $1, true), set_config('app.request_id', $2, true)` at the start of
every transaction. `changed_fields` computed by comparing `to_jsonb(OLD)` and `to_jsonb(NEW)` keys. Exclude
`updated_at`/`version` from `changed_fields`. A soft delete (deleted_at null → not null) is recorded as `soft_delete`.

**Template immutability trigger:** on `checklist_template_versions` UPDATE, if `OLD.published_at is not null` raise exception.

---

## 8. Business rules and calculations

All functions below live in `packages/shared/src/calc/` with full unit tests. Server stores results; client previews.

### 8.1 AQL (ISO 2859-1, single sampling, normal inspection)

**Lookup:**
1. `code_letter = aql_code_letters where inspection_level = L and lot_size between lot_min and lot_max`.
2. `plan = aql_plans where code_letter = X and aql = A` → `sample_size, accept (Ac), reject (Re)`.
3. If `sample_size >= lot_size` → 100% inspection: `sample_size = lot_size`; Ac/Re from the plan still apply.
4. Done separately for critical, major and minor with the buyer's AQL for each (from `buyer_quality_rules`, else factory default).
   Because arrows can give different sample sizes per AQL, the inspection's `sample_size` = the **largest** of the
   resolved sample sizes; each severity is judged against its own Ac/Re. Store the full resolution in `aql_snapshot`.
5. **Critical defects:** if `aql_critical = 0` (default), Ac = 0, Re = 1 regardless of tables (any critical = FAIL).

**Verdict:** `PASS` if `critical ≤ Ac_c AND major ≤ Ac_M AND minor ≤ Ac_m`; else `FAIL`.
A severity "fails" when count ≥ Re. Show per-severity status in the UI.

**Seed data:**
- `aql_code_letters` for General Inspection Levels I, II, III and Special Levels S-1..S-4 from ISO 2859-1 Table 1.
- `aql_plans` for AQL values 0.065, 0.10, 0.15, 0.25, 0.40, 0.65, 1.0, 1.5, 2.5, 4.0, 6.5 and code letters A–R from
  ISO 2859-1 Table 2-A, with the arrow rule ALREADY RESOLVED (when the table shows an arrow, follow it to the first
  plan below/above and store that plan's sample size, Ac and Re for that code letter + AQL).
- Seed files live in `db/seed/base/aql/*.json` with a comment header stating the source.
- **These tables must be reviewed and signed off by the client's QA lead.** Add a banner in the AQL admin screen:
  "Reference values — verify against your buyer manuals." Add a test fixture file with known values; the user/QA must
  confirm them. Reference rows commonly used in garments (Level II), use as test fixtures:

| Lot size | Code | Sample | AQL 2.5 Ac/Re | AQL 4.0 Ac/Re |
|---|---|---|---|---|
| 151–280 | G | 32 | 2/3 | 3/4 |
| 281–500 | H | 50 | 3/4 | 5/6 |
| 501–1200 | J | 80 | 5/6 | 7/8 |
| 1201–3200 | K | 125 | 7/8 | 10/11 |
| 3201–10000 | L | 200 | 10/11 | 14/15 |
| 10001–35000 | M | 315 | 14/15 | 21/22 |

### 8.2 Sewing quality KPIs

- **DHU (Defects per Hundred Units)** = `defects_total / pieces_checked × 100`.
- **Defective %** = `defective_pieces / pieces_checked × 100`.
- **RFT / FPY (Right First Time / First Pass Yield) %** = `first_pass_ok / pieces_checked × 100`.
  (A piece is first-pass OK if it had zero defects on its first check. Re-checks of reworked pieces do not increase
  `pieces_checked` for FPY.)
- **Rejection %** (final audit) = `failed_lots / total_lots × 100`.
- **AQL pass rate %** = `aql_pass / (aql_pass + aql_fail) × 100`.
- All KPIs return `null` when the denominator is 0; UI shows "—".
- Rounding: 2 decimals stored, 1 decimal displayed.

**DHU colour thresholds** (per factory, `settings.dhu_thresholds`): green if `DHU ≤ green_max`, amber if `≤ amber_max`,
red otherwise. Grey if `pieces_checked = 0` in the window.

### 8.3 Inline Traffic Light System (TLS)

For `sewing/inline` per operator per round: check `tls_round_sample` pieces (default 7).
- 0 defective → **green**; 1 defective → **amber**; ≥2 defective → **red**.
- Operator status = colour of the latest round. Three consecutive reds → auto-create a draft NCR suggestion for the supervisor
  (not auto-raised; supervisor confirms).
- Stored in `inspections.metrics = { "tls": "green|amber|red", "round": n }` with `operator_id` set.

### 8.4 Fabric 4-point system

Per defect: length ≤ 3 in → 1 pt; > 3 and ≤ 6 → 2 pts; > 6 and ≤ 9 → 3 pts; > 9 → 4 pts; any hole/opening → 4 pts
(defect code flag `is_hole`, stored in defect code metadata or category `hole`). Max 4 points per linear yard
(cap per `fp_yard_position` floor).

**Points per 100 sq yd** = `total_points × 3600 / (yards_inspected × cuttable_width_in)`.
Result PASS if `≤ limit` (buyer rule `four_point_limit`, else factory `four_point_default_limit`, default 40).
Store in `metrics = { "points": n, "yards": y, "width_in": w, "score": s, "limit": l }`.

### 8.5 Measurements and tolerance

`deviation = measured − spec`. Within tolerance if `−tol_minus ≤ deviation ≤ tol_plus`.
A piece fails measurement if any point is out of tolerance. Measurement inspections report:
points checked, points out, pieces out. Out-of-tolerance points are shown red with the deviation (e.g. `+1.4`).

### 8.6 Inspection state machine

```
draft ──submit──▶ submitted ──approve──▶ approved
                     │  └──reject──▶ rejected ──(inspector edits & resubmits)──▶ submitted
                     │
 (stage final_audit / aql types):
 submitted ──(result fail)──▶ on_hold ──release(with note)──▶ released
                                   └──re-inspect──▶ new inspection(parent_inspection_id, type re_inspection)
 submitted ──(result pass)──▶ released  (auto, if approval not required; else after approve)
 any non-released ──cancel (permission inspections.reopen, reason required)──▶ cancelled
 submitted/approved ──reopen (inspections.reopen, reason)──▶ draft (stats reversed, audit logged)
```

- Transitions implemented in `services/inspectionWorkflow.ts` with an explicit transition table; any other
  transition → `409 INVALID_TRANSITION`.
- Whether approval is required comes from `settings.inspection_approval_required[stage]`.
- Releasing a FAILED lot requires `inspections.release` + mandatory `release_note` (concession) and is highlighted red in
  history and in the audit pack.

### 8.7 CAPA workflow and escalation

```
open → investigating → action → verification → closed
```
- `investigating → action` requires `root_cause` (non-empty) and at least 1 five-why entry.
- `action → verification` requires all `capa_actions` done.
- `verification → closed` requires `capa.close`, `verified_by`, `effectiveness = 'effective'`.
  If `not_effective` → back to `action` (logged).
- Closing a CAPA closes its NCR automatically.
- **Escalation** (job every 5 min): for CAPAs not closed and `now() > due_at`, compute hours overdue; for each
  `escalation_rules` level whose `after_hours_overdue` is reached and `level > escalation_level`, set
  `escalation_level = level`, `last_escalated_at = now()`, notify users with `notify_role_id` in that factory/unit scope
  (+ owner), publish event. Default rules: L1 at 0 h (owner + supervisor), L2 at 24 h (QA Manager), L3 at 72 h (Management).
- Due-soon notification at 24 h before `due_at` (once, tracked in notification dedupe).

### 8.8 Reference numbers

`ref_no = {TYPE}-{FACTORY.code}-{YY}-{6-digit}` from `ref_counters` using
`INSERT ... ON CONFLICT DO UPDATE SET last_value = ref_counters.last_value + 1 RETURNING last_value`
inside the same transaction. Types: `INS`, `NCR`, `CAPA`, `AUD`, `CLM`, `DOC`, `PACK`.

### 8.9 Checklist template schema (JSON in `checklist_template_versions.schema`)

```ts
type TemplateSchema = {
  schemaVersion: 1;
  header: {                       // which context fields the inspector must pick before capture
    requireLine?: boolean; requireOrder?: boolean; requireColorSize?: boolean;
    requireOperator?: boolean; requireSubject?: EntityType | null; requireLotSize?: boolean;
  };
  capture: {                      // which capture widgets appear
    mode: 'checklist_only' | 'pieces' | 'aql' | 'four_point' | 'measurement' | 'tls';
    defectCapture: boolean;       // show tap-on-garment
    measurement?: boolean;        // pull style_measurements
    allowedDefectCategories?: string[];
  };
  sections: Array<{
    key: string; title: string;
    fields: Array<Field>;
  }>;
};
type Field = {
  key: string;                    // unique within template, snake_case
  type: 'pass_fail' | 'yes_no' | 'number' | 'text' | 'textarea' | 'select' | 'multiselect' | 'photo' | 'date' | 'time';
  label: string;
  help?: string;
  required?: boolean;
  options?: Array<{ value: string; label: string }>;
  min?: number; max?: number; unit?: string; step?: number;
  target?: number; tolPlus?: number; tolMinus?: number;   // number fields can auto-flag out-of-range
  failsInspection?: boolean;      // a 'fail'/'no'/out-of-range answer fails the inspection
  showIf?: { field: string; equals: string | boolean | number };
};
```

- Validator `validateTemplateSchema()` (shared) checks: unique keys, valid types, options present for select types,
  `showIf.field` exists and appears earlier, labels non-empty.
- Validator `validateAnswers(schema, answers)` checks required fields (respecting `showIf`), types, ranges.
- Inspection result for checklist-only modes: FAIL if any `failsInspection` field fails; else PASS.

---

## 9. API design conventions

### 9.1 Base

- Base path `/api/v1`. JSON only (except uploads and SSE). UTF-8.
- Authentication: `Authorization: Bearer <accessToken>` on all routes except `/auth/login`, `/auth/refresh`,
  `/health`, and display endpoints (display token).
- Every response includes `X-Request-Id`.

### 9.2 Envelope

```json
// success (single)
{ "data": { ... } }
// success (list)
{ "data": [ ... ], "meta": { "nextCursor": "string|null", "limit": 50 } }
// error
{ "error": { "code": "VERSION_CONFLICT", "message": "Human readable (en)", "details": { ... } } }
```

### 9.3 Error codes (constants in shared)

`VALIDATION_FAILED` (400, details = field errors), `UNAUTHENTICATED` (401), `TOKEN_EXPIRED` (401), `FORBIDDEN` (403),
`OUT_OF_SCOPE` (404 — never reveal existence), `NOT_FOUND` (404), `VERSION_CONFLICT` (409, details = current row),
`INVALID_TRANSITION` (409), `DRAFT_LOCKED` (409, details = lock holder name, device, since), `DUPLICATE` (409),
`IDEMPOTENCY_MISMATCH` (422, same key different body), `RATE_LIMITED` (429), `PAYLOAD_TOO_LARGE` (413),
`UNSUPPORTED_MEDIA` (415), `INTERNAL` (500).

### 9.4 Validation

Hand-written validators in `packages/shared/src/validators/`, built from small composable helpers:

```ts
type Issue = { path: string; code: string; message: string };
type Result<T> = { ok: true; value: T } | { ok: false; issues: Issue[] };
// helpers: str({min,max,trim}), int({min,max}), num(), bool(), uuid(), isoDate(), oneOf([...]),
//          arrayOf(v,{max}), object({ key: v, ... }), optional(v), nullable(v)
```
Each endpoint has a named validator (e.g. `createDefectInput`). `validate.ts` middleware runs it and replaces
`req.body` with the typed value. Unknown keys are stripped. Same validators run in web forms.

### 9.5 Pagination

Cursor-based on `(sort_ts desc, id desc)`. `?limit=` default 50, max 200. `nextCursor` = base64url of `"<iso>|<uuid>"`.
Never use OFFSET on large tables. Filters as query params; arrays as comma-separated.

### 9.6 Idempotency middleware

For mutating requests with `Idempotency-Key`:
1. Hash `method + path + canonical JSON body` (sha256).
2. Look up `(key, user_id)`. If found and hash matches → return stored status/body with header `Idempotent-Replay: true`.
   If found and hash differs → `422 IDEMPOTENCY_MISMATCH`.
3. Otherwise run handler; on 2xx/4xx (not 5xx) store result. Use an `INSERT ... ON CONFLICT DO NOTHING` placeholder row
   before running the handler to block concurrent duplicates (second concurrent request waits/polls up to 5 s then 409).
4. Cleanup job deletes keys older than 48 h.
The web `apiClient` generates a key per logical action and reuses it on retry.

### 9.7 Optimistic concurrency

Update endpoints require `version` in the body. Return `409 VERSION_CONFLICT` with `details.current` so the UI can show
"Someone else changed this. Reload / Overwrite (if allowed)".

---

## 10. API endpoint catalogue

(All under `/api/v1`. "P:" = required permission. All list endpoints are scope-filtered.)

**Health & meta**
- `GET /health` → `{ status, db, time }` (no auth)
- `GET /meta/bootstrap` → current user, permissions, scopes, factories/units/lines in scope, shifts, stage labels,
  settings subset, enums, i18n version. Called once after login.

**Auth**
- `POST /auth/login` `{ username, password, deviceId }` → `{ accessToken, refreshToken, user, mustChangePassword }`
- `POST /auth/refresh` `{ refreshToken, deviceId }` → rotated pair (old token revoked; reuse of revoked token revokes the whole family)
- `POST /auth/logout` `{ refreshToken }`
- `POST /auth/change-password` `{ currentPassword, newPassword }`
- `GET /me`, `PATCH /me` (preferred_shell, name, phone, avatar)

**Users & roles** (P: users.manage / roles.manage)
- `GET/POST /users`, `GET/PATCH /users/:id`, `POST /users/:id/reset-password`, `POST /users/:id/deactivate`
- `PUT /users/:id/roles`, `PUT /users/:id/scopes`
- `GET /roles`, `POST /roles`, `PATCH /roles/:id`, `PUT /roles/:id/permissions`, `GET /permissions`

**Organization** (P: org.manage for writes)
- CRUD: `/factories`, `/units`, `/lines`, `/shifts`, `/operators` (+ `POST /operators/import` CSV)
- `PATCH /factories/:id/settings` (P: settings.manage)

**Master data** (P: masterdata.manage for writes)
- CRUD: `/buyers`, `/buyers/:id/quality-rules`, `/suppliers`, `/styles`, `/styles/:id/measurements`
  (+ `POST /styles/:id/measurements/import` CSV), `/orders`, `/orders/:id/breakdown`
- `GET /orders/:id/summary` (inspections, KPIs, CAPAs, cartons, shipment status)

**Configuration**
- `/templates` CRUD (P: templates.manage); `POST /templates/:id/versions` (new draft version, copies latest);
  `PATCH /templates/:id/versions/:vid` (draft only); `POST /templates/:id/versions/:vid/publish`;
  `GET /templates/resolve?stage=&type=&buyerId=` → best matching published version (buyer-specific first, then generic)
- `/defect-codes` CRUD (P: defects.manage), `GET /defect-codes?stage=` for capture
- `/garment-templates` (GET all; PUT P: garments.manage)
- `/aql/code-letters`, `/aql/plans` (GET; PUT P: aql.manage); `GET /aql/resolve?lotSize=&level=&critical=&major=&minor=`
- `/escalation-rules` CRUD (P: settings.manage)
- `/display-tokens` CRUD (P: display.manage) — token shown once on create

**Inspections**
- `POST /inspections` (P: inspections.create) — body includes client `id`, header context, template version → creates
  `draft` + `inspection_drafts` row with lock for this device
- `GET /inspections` filters: stage, type, status, result, unitId, lineId, orderId, buyerId, inspectorId, from, to, q
- `GET /inspections/:id` (full: header, answers, pieces, defects, measurements, photos, history from audit_log)
- `PUT /inspections/:id/draft` `{ payload, clientUpdatedAt, deviceId }` → saves draft, refreshes lock heartbeat;
  `409 DRAFT_LOCKED` if another device holds a fresh lock (heartbeat < 2 min old)
- `GET /inspections/:id/draft`
- `POST /inspections/:id/takeover` (P: inspections.takeover, or same user on new device after confirm)
- `POST /inspections/:id/submit` `{ payload, version }` → server validates, recomputes everything, writes normalized
  rows (pieces, defects, measurements), assigns ref_no, updates line stats, publishes events, deletes draft row,
  transitions per §8.6. Returns final inspection.
- `POST /inspections/:id/approve` | `/reject` `{ reason }` | `/hold` `{ reason }` | `/release` `{ note }` |
  `/reopen` `{ reason }` | `/cancel` `{ reason }` | `/reinspect` → creates linked draft
- `GET /inspections/drafts/mine`

**Photos & files**
- `POST /photos` multipart: fields `id, ownerType, ownerId, inspectionId?, defectId?, takenAt`, files `image`, `thumb`
  → idempotent on `id`. Max 5 MB image, 300 KB thumb. Magic-byte check JPEG/PNG/WebP.
- `GET /photos` (Photo Wall) filters: lineId, unitId, stage, defectCodeId, severity, orderId, styleId, buyerId, from, to, cursor
- `GET /photos/:id/file?variant=full|thumb` → permission check then `X-Accel-Redirect` (prod) / stream (dev)
- `POST /files` multipart (PDF/images ≤ 20 MB), `GET /files/:id/download`

**Traceability** (P: trace.view; writes P: labels.manage)
- CRUD: `/fabric-rolls`, `/trims-batches`, `/cutting-lays`, `/bundles` (+ `POST /cutting-lays/:id/generate-bundles`
  from breakdown), `/cartons` (+ `POST /orders/:id/cartons/bulk`), `/shipments`
- `POST /trace/links` `{ parentType, parentId, childType, childId, quantity }`, `DELETE /trace/links/:id`
- `POST /codes/generate` `{ entityType, entityIds[] }` → codes
- `GET /codes/:code` → `{ entityType, entityId, summary }`
- `GET /trace/:code` → timeline (§18.2)
- `GET /labels?codes=...` → printable label sheet data (front end renders print page)

**Live, dashboards, reports**
- `GET /lines/live?unitId=&date=` → tiles (§18.1)
- `GET /dashboard?unitId=&lineId=&buyerId=&stage=&from=&to=` → command center payload (§18.5)
- `GET /reports/inspections.csv?...` (P: reports.export), `GET /reports/defects.csv`, `GET /reports/dhu.csv`,
  `GET /reports/capa.csv`
- `GET /reports/operator-performance?lineId=&from=&to=`
- `POST /reports/audit-pack` `{ orderId }` (P: auditpack.generate) → snapshot id
- `GET /reports/snapshots`, `GET /reports/snapshots/:id`

**NCR / CAPA**
- `POST /ncrs` (P: ncr.create), `GET /ncrs`, `GET/PATCH /ncrs/:id`, `POST /ncrs/:id/cancel`
- `POST /ncrs/:id/capa` (P: capa.manage) — creates CAPA with owner + due date
- `GET /capas?view=board` (grouped by status), `GET /capas/:id`, `PATCH /capas/:id`
- `POST /capas/:id/transition` `{ to, version, ...requiredFields }`
- `PATCH /capas/:id/position` `{ status, boardPosition, version }` (drag & drop)
- `POST /capas/:id/actions`, `PATCH /capa-actions/:id`, `POST /capas/:id/comments`

**Notifications**
- `GET /notifications?unread=1`, `POST /notifications/:id/read`, `POST /notifications/read-all`

**QMS** (P: matching qms.* for writes, qms.view for reads)
- CRUD: `/documents` (+ `/documents/:id/revisions`, `POST .../approve`), `/instruments` (+ `/calibrations`),
  `/trainings` (+ `/attendance`), `/audits` (+ `/findings`, `POST /findings/:id/raise-ncr`), `/claims`
  (+ `POST /claims/:id/raise-ncr`), `/lab-tests`

**Archive** (P: archive.manage)
- `GET /archives`, `POST /archives/run` `{ orderId? }`, `POST /archives/:id/restore` (multipart upload of the ZIP or from target path),
  `GET /archives/:id/download`

**Events (SSE)**
- `POST /stream/ticket` → `{ ticket }` (one-time, 60 s, stored hashed in memory map with user id + scopes)
- `GET /stream?ticket=...&topics=lines:<unitId>,notifications,capa:<factoryId>` → `text/event-stream`
- Display: `GET /display/lines?token=...&unitId=` (tiles JSON), `GET /display/stream?token=...` (SSE)

**Audit log** — `GET /audit-log?table=&rowId=&userId=&from=&to=` (P: auditlog.view)

---

## 11. Authentication and security

- **Passwords:** bcrypt cost 12. Policy: min 8 chars, at least 1 letter + 1 digit. No max below 64.
- **Access token:** JWT HS256, 15 min, claims `{ sub, sid (refresh family id), iat, exp }`. Secret from `JWT_SECRET` (≥ 32 bytes).
  Permissions are NOT embedded; loaded per request from a 30-second in-process cache keyed by user id (invalidated on role/scope change).
- **Refresh token:** 256-bit random, base64url; stored as sha256 in `refresh_tokens`; 30-day expiry; rotated on every use;
  reuse of a revoked token revokes all tokens of that user+device and returns 401.
- **Client storage:** access token in memory; refresh token in `localStorage` (required for future app wrapper, no cookies).
  Mitigate XSS with strict CSP and no `dangerouslySetInnerHTML` (exception: garment SVG paths rendered via `<path d>` from trusted seed data only).
- **Login protection:** 5 failed attempts per username → `locked_until = now() + 15 min`; 30 failed per IP per 15 min → 429.
  Generic error message ("Invalid username or password").
- **Security headers** (in-house middleware):
  `Content-Security-Policy: default-src 'self'; img-src 'self' blob: data:; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; script-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'`,
  `X-Content-Type-Options: nosniff`, `Referrer-Policy: same-origin`, `X-Frame-Options: DENY`,
  `Permissions-Policy: camera=(self), geolocation=()`, HSTS in production.
- **CORS:** same-origin in production (Nginx serves both). In dev, allow `http://localhost:5173` only.
- **Uploads:** check magic bytes, ignore client MIME; random file names; never serve uploads from the web root directly.
- **SQL:** parameterized queries only. A lint rule/grep test fails the build if template literals with `${` appear inside
  `pool.query(`/`client.query(` calls in `repos/` (except the documented `scopeClause` builder).
- **Logging:** JSON lines `{ time, level, requestId, userId, method, path, status, ms }`. Never log passwords, tokens, bodies of auth routes.
- **Scope enforcement:** see §5.4. Reads by id outside scope return 404.

---

## 12. Background jobs, events and live updates

### 12.1 Worker

- Runs inside the API process (`server.ts` starts it) with `WORKER_ENABLED=true`; can be split later.
- Loop every 1 s: claim up to 5 jobs:
  ```sql
  update jobs set status='running', locked_at=now(), locked_by=$worker, attempts=attempts+1
  where id in (select id from jobs where status='queued' and run_at <= now()
               order by priority desc, run_at limit 5 for update skip locked)
  returning *;
  ```
- On success `status='done', finished_at=now()`; on error `last_error`, and if `attempts < max_attempts` →
  `status='queued', run_at = now() + backoff` (30 s × 2^attempts, max 1 h); else `status='dead'`.
- Reaper: jobs `running` with `locked_at < now() - 10 min` → back to `queued`.
- Graceful shutdown: stop claiming, finish running jobs (max 30 s).

### 12.2 Recurring jobs (scheduler enqueues with `dedupe_key = type + time bucket`)

| Job | Schedule | Purpose |
|---|---|---|
| `capa.escalate` | every 5 min | §8.7 escalation + due-soon |
| `calibration.check` | daily 06:00 local | set `due`/`overdue`, notify lab/QA |
| `documents.review_due` | daily 06:00 | notify document owners |
| `stats.refresh_daily` | every 5 min (today) + 02:00 nightly (last 3 days) | rebuild daily_* tables |
| `archive.scan` | daily 01:00 | enqueue `archive.order` for orders shipped > retention days with hot photos |
| `archive.order` | on demand | §13.4 |
| `cleanup.idempotency` | hourly | delete > 48 h |
| `cleanup.drafts` | daily | notify owners of drafts idle > 7 days; never auto-delete |
| `cleanup.stale_tickets` | in-memory, every minute | SSE tickets |

### 12.3 Events

- `publish(topic, data)` → `select pg_notify('tqm_events', json)` with payload `{ topic, type, ids }`
  (keep < 4 KB; send ids, not full records).
- A dedicated `pg` client runs `LISTEN tqm_events` (reconnect with backoff) and forwards to the SSE hub.
- Topics: `lines:<unitId>` (type `line.updated`, ids = lineIds), `notifications:<userId>`, `capa:<factoryId>`,
  `inspection:<id>` (draft lock events), `dashboard:<factoryId>` (type `stats.refreshed`).

### 12.4 SSE hub

- `GET /stream` validates one-time ticket, checks the user may subscribe to each topic (scope), sets headers:
  `Content-Type: text/event-stream`, `Cache-Control: no-cache, no-transform`, `X-Accel-Buffering: no`, `Connection: keep-alive`.
- Sends `retry: 5000`, an initial `event: ready`, heartbeat comment `: ping` every 25 s.
- Message format: `id: <monotonic>\nevent: <type>\ndata: <json>\n\n`.
- Client (`data/sse.ts`): fetch ticket → open `EventSource` → on error close, wait (1 s, 2 s, 5 s, 10 s max), get a new
  ticket, reopen. On reconnect, trigger a full refetch of subscribed views (events may have been missed).
- Fallback: if SSE fails 3 times in a row, poll the same endpoints every 20 s and show "Live updates paused" chip.

---

## 13. Files, photos, retention and archiving

### 13.1 Client-side capture and compression

1. `<input type="file" accept="image/*" capture="environment">` (hidden; triggered by a big camera button).
2. Read into `ImageBitmap` (`createImageBitmap(file, { imageOrientation: 'from-image' })`), fallback `<img>`.
3. Draw to canvas: full = long edge ≤ 1600 px; thumb = long edge ≤ 320 px.
4. Encode `canvas.toBlob(cb, 'image/webp', 0.8)`; if result is null or not webp (older iOS) → `'image/jpeg', 0.82`.
   Thumb quality 0.7.
5. Strip nothing else needed (canvas output has no EXIF/GPS).
6. Store both blobs in IndexedDB store `pendingPhotos` `{ id, ownerType, ownerId, inspectionId, defectId, takenAt, full, thumb, attempts, lastError }`.
7. Show the local thumb immediately (object URL) with an upload-state ring.

### 13.2 Upload queue (`uploads/queue.ts`)

- Processes one photo at a time; on app start resumes pending items.
- `POST /photos` with `Idempotency-Key = photo.id`. Retry with backoff 2 s, 5 s, 15 s, 30 s, 60 s (repeat 60 s).
- Pauses when offline (`navigator.onLine === false` or last request network-failed), resumes on `online` event.
- Inspection submit is blocked while that inspection has pending photos; the submit button shows
  "Uploading photos 2/5…". After upload success, delete blobs from IndexedDB.
- If `require_photo_for_severity` includes a defect's severity, that defect cannot be saved without a photo.

### 13.3 Server storage

- Root `UPLOAD_DIR` (default `/data/uploads`). Path: `{factoryId}/{yyyy}/{mm}/{photoId}.{ext}` and `{photoId}_t.{ext}`.
- Write to temp file then rename (atomic). Compute sha256. Save dimensions (read from the WebP/JPEG/PNG header — implement
  a small header parser) and bytes.
- Serve via `GET /photos/:id/file`: permission & scope check, then in production respond with
  `X-Accel-Redirect: /_protected/uploads/<path>` and Nginx serves the file from an `internal` location with
  `Cache-Control: private, max-age=86400`.

### 13.4 Retention and archiving

- Policy: `settings.photo_retention_days_after_ship` (default 90). Applies only to **full-size** photos of orders with
  `status in ('shipped','closed')` and `shipped_at < now() - retention`. **Thumbnails, all structured data, and audit pack
  snapshots are kept forever.**
- `archive.order` job:
  1. Ensure an audit pack snapshot exists for the order; generate one if not (§18.8).
  2. Collect hot full-size photos of the order.
  3. Write ZIP part(s) to `{ARCHIVE_DIR}/{factoryCode}/{orderNo}/{orderNo}_photos_part{n}.zip` using the in-house writer:
     STORE method, CRC32 via `zlib.crc32`, UTF-8 names, part size cap 2 GB (no ZIP64 needed).
     Include `manifest.json` = `[{ photoId, file, sha256, bytes, takenAt, inspectionRef, defectCode }]`.
  4. Write `archives` row (`writing` → `verifying`).
  5. Verify: re-read the ZIP central directory, recompute sha256 of each entry, compare to manifest and DB.
  6. On success in one DB transaction: set photos `state='archived', archive_id`, mark archive `complete`, then delete the
     full-size files from disk (after commit). On any failure: archive `failed`, nothing deleted, notify `archive.manage` users.
- Restore: `POST /archives/:id/restore` reads ZIP (from target path, or uploaded), verifies hashes, rewrites files,
  sets photos back to `hot`, archive `restored`.
- UI: archived full photos show the thumbnail with a badge "Archived — restore to view full size".
- `ARCHIVE_DIR` is a mounted folder (factory NAS share mounted on the host). S3-compatible targets are out of scope.

### 13.5 Backups

`deploy/backup.sh`: nightly `pg_dump -Fc` to `/backups/db/YYYY-MM-DD.dump`; keep 14 daily + 8 weekly (Sunday) files;
rsync `/data/uploads` to `/backups/uploads` (incremental). Document restore steps in `docs/OPERATIONS.md`, and test a
restore in Milestone 14.

---

## 14. Frontend architecture

### 14.1 Routing

```
/login
/change-password
/f                         Floor home
/f/inspect/new             start inspection wizard
/f/inspect/:id             capture screen (the core)
/f/inspect/:id/review      review & submit
/f/scan                    scan → trace or start inspection on that subject
/f/drafts
/f/alerts
/f/me
/d                         Quality Command Center
/d/lines                   Live Line Heatmap
/d/inspections             list
/d/inspections/:id         detail
/d/trace                   Trace Explorer (search)
/d/trace/:code             Trace timeline
/d/photos                  Defect Photo Wall
/d/ncr, /d/ncr/:id
/d/capa                    CAPA board
/d/capa/:id
/d/orders, /d/orders/:id
/d/reports                 report center (CSV exports, operator performance, snapshots)
/d/qms/documents | calibration | training | audits | claims | lab
/d/admin/users | roles | org | operators | buyers | suppliers | styles | templates | templates/:id
        | defects | garments | aql | escalation | display | archive | settings | audit-log
/display/lines             wall display (token in query)
/print/audit-pack/:snapshotId
/print/labels              label sheet (codes in query)
/print/inspection/:id
```

- Route guards: `RequireAuth`, `RequirePermission(perm)`, `RequireShell`. Unauthorized → friendly 403 page.
- Code-split each feature with `React.lazy`.

### 14.2 Data layer

- `apiClient.request(method, path, { body, idempotencyKey, signal })`:
  attaches Bearer token; on `TOKEN_EXPIRED` performs a single-flight refresh then retries once; parses envelope; throws
  typed `ApiError { code, status, details }`; network errors throw `NetworkError` (used by the online indicator).
  Mutations get an auto idempotency key unless provided.
- `useQuery(key, fn, { staleTime, refetchOnFocus })` — tiny in-house cache: `Map<key, {data, error, ts, promise}>`,
  dedupes in-flight requests, `invalidate(prefix)`, refetch on window focus and on SSE events.
- `useMutation(fn, { onSuccess, invalidate: [...] })`.
- `dataSource.ts` exports grouped functions: `auth`, `meta`, `inspections`, `drafts`, `photos`, `defects`, `templates`,
  `trace`, `lines`, `dashboard`, `ncr`, `capa`, `notifications`, `qms`, `admin`, `reports`, `archive`.

### 14.3 i18n

- `i18n/en.json` — flat keys `area.thing.label`. A test asserts no value is empty and every key used in code exists.
- `useT()` returns `t(key, vars?)` with `{name}` interpolation and simple plural `key_one`/`key_other`.
- Locale is fixed to `en` in Phase A (no switcher). Adding a language later = new catalog + switcher.
- Numbers: `Intl.NumberFormat('en-US')`. Dates: `Intl.DateTimeFormat('en-GB')` with the factory timezone.

### 14.4 Hooks

`useBreakpoint()` (sm < 640, md < 1024, lg ≥ 1024), `useOnline()` (navigator + last request status),
`useBackGuard(active, onAttemptLeave)` (§14.7), `useInterval`, `useDebouncedCallback`, `useLocalStorage`,
`useEventStream(topics, handler)`, `usePermission(key)`.

### 14.5 Shell selection

`AppShell` picks `FloorLayout` or `DeskLayout` from (session override) → `users.preferred_shell` → role default.
Floor routes under `/f`, desk routes under `/d`; landing `/` redirects to the right one.

### 14.6 Draft engine (`drafts/`)

Draft payload shape (versioned for future migrations):
```ts
type DraftPayload = {
  draftSchema: 1;
  inspectionId: string;
  header: {...};                 // context chosen in the start wizard
  answers: Record<string, unknown>;
  pieces: Array<{ pieceNo: number; isDefective: boolean; checkedAt: string }>;
  defects: Array<{ id: string; pieceNo?: number; defectCodeId: string; severity: Severity; quantity: number;
                   operatorId?: string; view?: 'front'|'back'; x?: number; y?: number; zone?: string;
                   photoId?: string; remark?: string; fp?: {...} }>;
  measurements: Array<{ id: string; pieceNo: number; pointCode: string; size: string; measuredValue: number }>;
  photoIds: string[];
  ui: { currentSection?: string; currentPiece?: number; view?: 'front'|'back' };
  clientUpdatedAt: string;       // ISO
};
```
- Every state change updates the in-memory draft, writes it to `localStorage['draft:<id>']` immediately, and schedules a
  server save (debounce 1500 ms, max wait 5 s).
- Server save: `PUT /inspections/:id/draft`. Status chip: "Saving…", "Saved · 3s ago", "Offline — saved on this device",
  "Not saved — retrying".
- Heartbeat: if no change for 60 s, send a lightweight heartbeat to keep the lock fresh.
- **Restore on load:** fetch server draft and local draft; use the one with the newer `clientUpdatedAt`; if the local one
  is newer, push it to the server. If the server returns `DRAFT_LOCKED`, show a full-screen notice
  "This inspection is open on another device (Name, Tablet-03, since 10:42)" with actions
  "Take over" (if permitted/same user) and "Back".
- After successful submit: remove `localStorage` entry and IndexedDB pending items for that inspection.

### 14.7 Leaving an inspection in progress

- `useBackGuard(active)`: on mount pushes a sentinel history entry (`history.pushState({guard: true}, '')`); on
  `popstate`, re-push the sentinel and open the "Leave inspection?" modal: **Save draft & exit** (flush save, then navigate
  to `/f/drafts`) / **Continue inspection**.
- In-app navigation (links, bottom nav) goes through the same modal via a `navigate` wrapper.
- `beforeunload` handler set only while there are unsaved changes or pending uploads (browser shows its generic dialog).
- Refresh restores exactly: same section, same piece, same garment view (from `ui` in payload).
- Do NOT attempt to block the OS back gesture beyond this; kiosk mode (Phase B) handles it.

### 14.8 PWA basics (Phase A)

- `manifest.webmanifest` (name, short_name, icons 192/512 maskable, `display: standalone`, `orientation: any`,
  theme/background colours, `start_url: "/"`).
- **No service worker in Phase A** (prevents stale-cache bugs; online-only). Phase B adds offline.

---

## 15. Design system

### 15.1 Principles

- Floor: big, bold, one task per screen, thumb-reachable actions at the bottom, minimum touch target **48×48 px**
  (primary capture buttons 64 px tall), high contrast, works in bright factory light, readable at arm's length.
- Desk: dense, calm, data-first; tables and split views; keyboard friendly.
- Colour is never the only signal: every status also has an icon or text.

### 15.2 Tokens (Tailwind v4 `@theme` in `styles/theme.css`)

```
--font-sans: "Inter", system-ui, sans-serif;
--color-brand-50..900       (accent; default indigo-ish, overridable per factory later)
--color-ink-900/700/500/300  text
--color-surface / surface-muted / surface-raised / border
--color-ok-500 #16a34a, --color-ok-50
--color-warn-500 #d97706, --color-warn-50
--color-bad-500 #dc2626, --color-bad-50
--color-info-500 #2563eb
--color-idle-400 #9ca3af   (no data)
radius: sm 6px, md 10px, lg 14px, xl 20px
shadow: card, raised, overlay
```
- Dark mode: Desk supports light/dark (`prefers-color-scheme` + manual toggle). Floor is light-only (glare).
  Wall display is dark-only.
- Fonts via Google Fonts `<link>` in `index.html`: Inter (400/500/600/700).
  Numbers use `font-variant-numeric: tabular-nums` in tables, KPIs and counters.

### 15.3 Components (`components/`) — build all, document props in a dev-only `/dev/components` page

`Button` (primary/secondary/ghost/danger; sizes sm/md/lg/xl), `IconButton`, `Input`, `NumberStepper`, `Textarea`,
`Select` (native on Floor, custom searchable on Desk), `Combobox` (async search), `Checkbox`, `Switch`,
`SegmentedControl`, `PassFailToggle` (two big buttons ✓ / ✗), `DatePicker` (native input), `Badge`, `StatusBadge`
(inspection/capa statuses with icons), `ResultBadge` (PASS/FAIL large), `Card`, `KpiCard`, `Tabs`, `Modal`, `Sheet`
(bottom sheet on Floor, side panel on Desk), `Toast`, `ConfirmDialog`, `EmptyState`, `Skeleton`, `Spinner`, `Avatar`,
`ConnectionDot`, `SaveStatusChip`, `UploadRing`, `FilterBar` (chips + date range; state in URL query),
`DataTable` (desk table / mobile cards, sorting, column visibility, sticky header, cursor pagination "Load more",
row click, selection), `SplitView`, `Timeline`, `Kanban`, `PhotoThumb`, `Lightbox`, `PageHeader`, `Breadcrumbs`,
`PermissionGate`, `ErrorBoundary`.

### 15.4 Charts (`charts/`, pure SVG, responsive via `viewBox` + ResizeObserver width)

`Sparkline`, `TrendLine` (multi-series, hover crosshair + tooltip, target line), `BarChart` (vertical/horizontal),
`ParetoChart` (bars + cumulative % line + 80% reference line), `Donut` (pass/fail), `HeatGrid` (line × hour),
`Gauge` (semi-circle for DHU vs target). Axis ticks with "nice numbers" algorithm. All charts accessible
(`role="img"`, `aria-label` summary, hidden data table for screen readers).

### 15.5 Print styles (`styles/print.css`)

A4 portrait, 15 mm margins, `break-before: page` for sections, `break-inside: avoid` for cards/tables rows,
repeat table headers (`thead { display: table-header-group }`), header/footer with factory name, report title,
page "x of y" via CSS counters where supported, hide app chrome.

---

## 16. Floor shell (phone/tablet) — screens

**Layout:** top bar (factory/unit/line chip, ConnectionDot, notifications bell) + content + bottom nav
(Inspect · Scan · Drafts · Alerts · Me). During capture the bottom nav is hidden and replaced by the capture action bar.

### 16.1 Floor home `/f`
- Greeting + today's date/shift.
- "Continue" cards for own drafts (most recent first).
- "Start inspection" big buttons for the user's allowed stages (from scopes) — each shows stage icon + label.
- Today's own stats: inspections done, pieces checked, DHU for my line.
- Unread alerts preview.

### 16.2 Start inspection wizard `/f/inspect/new`
Steps (skip any not required by the resolved template header):
1. Stage → inspection type (only allowed combinations).
1b. Garment type (shirt, pant, jacket, …; pre-filled from the style once an order is picked) and **cost per piece**
   (required, > 0, in the factory currency; pre-filled with the last value used for the same style + garment type but
   must be confirmed). The check cannot be created without it.
2. Line (pre-selected from scope if single) / subject scan (roll, bundle, carton) via Scan button or code entry.
3. Order (searchable by PO/style; recent orders first) → color → size.
4. Operator (for inline/TLS) — searchable list of line operators with codes.
5. Lot size (for AQL types) → shows resolved sample size live ("Lot 3,200 → sample 200, Level II").
6. Confirm → client creates UUID, `POST /inspections`, navigates to capture.
Wizard state persists in sessionStorage so a refresh mid-wizard doesn't lose choices.

### 16.3 Capture screen `/f/inspect/:id` — the core screen
Header: stage label · ref ("Draft") · order/style/color/size · SaveStatusChip · ConnectionDot · menu (save & exit, cancel).
Body depends on `capture.mode`:

- **pieces mode (endline):** big counters (Checked · Defective · Defects · live DHU); garment canvas (§18.3);
  bottom action bar: **✓ OK piece** (green, 64 px) · **Defective piece** (red) · **Undo**.
  Flow: tapping garment while a piece is "open" adds defects to the current piece; "Next piece" closes it.
  "✓ OK piece" increments checked and first_pass_ok instantly (target: < 1 s per good piece).
- **aql mode:** sample progress "37 / 200", per-severity counters vs Ac/Re with colour, same garment canvas, live
  verdict preview; "Finish sampling" enabled when sample complete (or early fail declared when any severity reaches Re,
  with confirmation).
- **tls mode:** operator header, 7 slots (configurable) to tap OK/defective; defect sheet for defective; colour result.
- **four_point mode:** roll header (roll no, width, length); yard counter with +1/+5/+10; "Add defect" → defect code,
  length in inches (number pad), position auto from yard counter, photo; live points & score per 100 sq yd vs limit.
- **measurement mode:** piece selector, list of points for the chosen size with spec ± tol; numeric keypad entry;
  each value instantly green/red with deviation; "Next piece".
- **checklist_only mode:** sections as accordion; fields rendered by `ChecklistRenderer`; `PassFailToggle` for pass_fail.
- Templates may combine: checklist sections always render below/after the mode-specific widget (tab "Checklist").

### 16.4 Review & submit `/f/inspect/:id/review`
Summary of all counts, verdict preview, list of defects with thumbs, missing required fields highlighted (tap to jump),
pending uploads progress, notes field, **Submit** (disabled until valid and uploads done). After submit: result screen
with big ResultBadge, ref_no, and actions: "New inspection (same line)", "Raise NCR" (prefilled), "Home".

### 16.5 Scan `/f/scan`
- If `BarcodeDetector` is available: full-screen camera with a framing box, torch toggle if supported, decodes QR + Code128.
- Always shows a text field with autofocus (hardware scanners type + Enter) and manual entry.
- Result → entity card (type, ID, order, status) with actions: "View trace", "Start inspection on this", "Print label" (if permitted).

### 16.6 Drafts, Alerts, Me
- Drafts: own drafts with age, stage, progress; swipe/long-press to cancel (with reason).
- Alerts: notifications list; tap navigates.
- Me: shell switch (if allowed), change password, logout, app version, device ID.

---

## 17. Desk shell (PC) — screens

**Layout:** left sidebar (collapsible; groups: Overview [Command Center, Live Lines], Quality [Inspections, Trace,
Photos], Actions [NCR, CAPA], Orders, Reports, QMS [Documents, Calibration, Training, Audits, Claims, Lab],
Admin [...]); top bar with global FilterBar (factory → unit, date range presets: Today, Yesterday, 7d, 30d, This month,
Custom), global search (`/` shortcut: search ref_no, PO, style, code), notifications, profile.
Sidebar items hidden when the user lacks permission.

### 17.1 Inspections list `/d/inspections`
DataTable columns: Ref, Date/time, Stage, Type, Unit/Line, Order/Style, Buyer, Inspector, Checked, Defects, DHU,
Result, Status. Filters in FilterBar + column filters. Row click → SplitView detail on the right (lg) or page (md).
Export CSV button (permission).

### 17.2 Inspection detail `/d/inspections/:id`
Header with ResultBadge and status actions (approve/reject/hold/release/reopen/re-inspect per permission & state).
Tabs: Summary (KPIs, AQL snapshot, metrics), Defects (garment canvas read-only with all pins + table), Measurements
(table with red cells), Checklist (answers), Photos (grid + lightbox), History (from audit_log, human-readable), Linked
(re-inspections, NCRs). "Print" → `/print/inspection/:id`.

### 17.3 Orders `/d/orders/:id`
Order summary: buyer, style, qty, ship date; KPI strip; inspections per stage (timeline of stage completion);
open NCR/CAPA; cartons & shipment; buttons: "Generate audit pack", "View trace".

### 17.4 Reports center `/d/reports`
- Exports: inspections, defects, DHU by line/day, CAPA register (CSV with BOM).
- Operator performance: table per operator (checked, defects, DHU, TLS reds), sortable; bar chart of worst 10.
- Snapshots: list of audit packs with open/print.

### 17.5 Admin screens
- Users: table + drawer form; roles multi-select; scopes editor (factory/unit/stage/buyer rows); reset password shows
  temporary password once.
- Roles: permission matrix (grouped checkboxes).
- Org: tree factory → units → lines; shifts table.
- Operators: table + CSV import with preview & error report.
- Buyers (with quality rules table per stage), Suppliers, Styles (with measurement spec grid editor: points × sizes,
  CSV import), Orders (with breakdown grid).
- **Templates (Checklist Builder):** left: section/field tree with drag to reorder (native DnD); middle: field editor
  (type, label, help, required, options, ranges, failsInspection, showIf); right: live preview rendered by the real
  `ChecklistRenderer` in a tablet-sized frame. Versions panel: draft vs published; Publish with change note; published
  versions are read-only; "Duplicate as new template".
- Defects: library table (code, name, category, stages, default severity, active), add/edit, import CSV.
- Garments: preview outlines with zone overlays (read-only in Phase A except name labels).
- AQL: code letter table and plan table (editable, with the verification banner).
- Escalation rules, Display tokens (create shows token once + copyable wall URL), Archive (policy, runs list, run now,
  restore), Settings (thresholds, labels, approvals, logo upload), Audit log (filterable).

---

## 18. The 8 showcase features — detailed specs

These are the screens used for marketing screenshots. They must look polished with demo data (§20).

### 18.1 Live Line Heatmap (`/d/lines`, `/display/lines`)

**Data:** `GET /lines/live?unitId&date` returns per line:
```json
{ "lineId": "...", "code": "L-07", "name": "Line 07", "unitCode": "U1",
  "today": { "checked": 1240, "defective": 61, "defects": 74, "dhu": 5.97, "fpy": 95.1 },
  "lastHour": { "checked": 140, "defects": 11, "dhu": 7.86 },
  "hours": [ { "hour": 8, "dhu": 3.1, "checked": 150 }, ... ],
  "topDefect": { "code": "SEW-01", "name": "Broken stitch", "count": 18 },
  "status": "red", "trend": "up", "lastInspectionAt": "..." }
```
`status` uses the last-hour DHU if `lastHour.checked ≥ 20`, else today's DHU. `trend` compares last hour vs previous hour
(±10% band = flat).

**UI (desk):** header with unit selector, date, legend (green/amber/red/idle with thresholds), summary strip
(unit DHU, lines red count, total checked). Grid `repeat(auto-fill, minmax(220px, 1fr))`. Each `LineTile`:
large line code, DHU (big, tabular), trend arrow, checked count, top defect chip, mini hourly sparkline, status colour
as left border + tinted background + icon (✓ / ! / ✕). Pulse animation 1.2 s when updated by SSE. Click → drawer with
hourly HeatGrid, defect Pareto for the line, operator TLS list, latest inspections. Toggle: "Tiles | Hour grid"
(HeatGrid lines × hours).

**Wall display:** dark theme, no chrome, auto-fit grid to fill 1920×1080 with up to 40 tiles, large fonts (line code
48 px, DHU 64 px), rotating footer with unit KPIs, clock, "Updated 12 s ago", auto-reconnect, reload page every 6 h,
works with a display token only (no user login).

**Live update path:** submit → transactional upsert into `line_hourly_*` → `publish('lines:<unitId>', {ids:[lineId]})`
→ SSE → client refetches only affected tiles (`GET /lines/live?unitId&lineIds=`). Latency target: tile updates < 3 s after submit.

### 18.2 Scan-to-Trace Timeline (`/f/scan` → trace, `/d/trace/:code`)

**Server:** resolve code → entity. Walk up with recursive CTE over `trace_links` (child → parent, max depth 10) and down
one level for context (e.g. a roll's bundles count). For each node collect: entity details, latest inspection
(ref, result, inspector name, time, DHU/score), photo thumb (first), open NCR count, supplier for root nodes.
Return nodes ordered from the scanned item back to the source:
`Carton → Packing audit → Finishing check → Sewing line (+ endline stats for that bundle/order/color/size) → Bundle →
Cutting lay → Fabric roll (4-point score) → Supplier`, plus the order header and shipment (if any) on top.

**UI:** vertical Timeline; each node: stage icon, title ("Fabric roll FR-8K2M…"), key facts, inspector avatar + time,
ResultBadge, thumb (tap → lightbox), "View inspection" link. Failed nodes highlighted red. Desk version shows a split view
(timeline left, selected node detail right) and a search box (`/d/trace`) accepting any code, PO or roll number.

### 18.3 Tap-on-Garment Defect Capture (capture screen)

- `garment_templates` provides SVG outlines for: `tshirt`, `polo`, `shirt`, `trouser`, `shorts`, `jacket`, `hoodie`,
  `dress`, `skirt` — front and back. Claude Code must DRAW these as original, simple, clean single-colour line-art paths
  (viewBox `0 0 1000 1200`), and define zones as polygons (e.g. tshirt: neck/collar, left sleeve, right sleeve,
  front body upper, front body lower, hem, side seam left/right, armhole left/right; back equivalents + back neck label).
  Zone names have English labels.
- Canvas component `GarmentCanvas`: renders the outline scaled to available space (keep aspect), front/back segmented
  toggle, existing pins (colour by severity: critical dark red, major red, minor amber; number inside = defect index),
  tap handler converts to normalized `x,y` (0–1 relative to viewBox) and computes zone with shared `pointInPolygon`
  (ray casting). Tap outside the outline → toast "Tap on the garment".
- Tap opens `DefectSheet` (bottom sheet): zone name at top; **Recent** (last 6 codes used by this user for this stage)
  as big chips; search field (name or code); category tabs; selecting a code → severity pre-selected from default
  (tap to change) → quantity stepper (default 1) → optional operator (inline: pre-filled) → camera button → Save.
  Target: a repeat defect in ≤ 3 taps and ≤ 5 seconds.
- Pins draggable for 5 s after creation (to correct position), long-press a pin → edit/delete.
- Read-only variant on desk detail with a hover tooltip per pin and a "heat" mode aggregating many inspections
  (used in order/line drill-downs: density dots).

### 18.4 AQL Audit Verdict Screen

- Header: order/style/color, lot size, inspection level, code letter, sample size, buyer AQLs ("Critical 0 · Major 2.5 · Minor 4.0").
- Live table: severity | found | accept | reject | status (✓ within / ✕ rejected), updating as defects are logged.
- Progress ring: sampled / sample size.
- On submit the server returns the official verdict → full-width ResultBadge **PASS** (green) / **FAIL** (red) with
  icon, animation (scale-in 200 ms), summary line ("Major 3 of 10 allowed · Minor 7 of 14 allowed").
- Actions by state & permission: **Release lot** (pass, or fail with mandatory concession note), **Hold lot** (reason),
  **Re-inspect** (fail → creates linked inspection), **Raise NCR** (prefilled from defects).
- Desk detail shows the same block plus the AQL snapshot source rows for auditability.

### 18.5 Quality Command Center (`/d`)

**Payload** (`GET /dashboard`, from `daily_*` tables + today from `line_hourly_*`):
```
kpis: { dhu, dhuPrev, fpy, fpyPrev, defectivePct, aqlPassRate, aqlPassRatePrev, inspections, piecesChecked,
        openNcr, overdueCapa }
trend: [ { date, dhu, fpy, aqlPassRate } ]           // per day in range
pareto: [ { defectCodeId, code, name, count, cumulativePct } ]  // top 10
worstLines: [ { lineId, code, dhu, checked, delta } ]           // top 5
byBuyer: [ { buyerId, name, aqlPassRate, lots } ]
byStage: [ { stage, inspections, failRate } ]
recentFails: [ { inspectionId, refNo, stage, line, order, at } ]
```
**Decision (1.1):** the mockup adds Rejection Rate (§8.2, failed final-audit lots %), "Worst buyers" (by rejection rate)
and On-Time Delivery (`orders shipped on or before ship_date / orders shipped`, in range). These are included in the payload
(`kpis.rejectionRate`, `kpis.onTimeDelivery`, `worstBuyers`) and in the layout below.

**UI:** row 1: KpiCards (DHU, FPY/RFT, Rejection Rate, AQL pass rate, Open NCR, Overdue CAPA) each with delta vs previous
period (arrow + colour: for DHU down is good). Row 2: TrendLine (30 days DHU + FPY dual axis, target line from
threshold) | Gauge for today's DHU. Row 3: ParetoChart top defects | Worst lines table with sparkline. Row 4: buyer AQL
table | recent fails list. Every element drills down (navigates with filters in URL). Filters in URL so views are
shareable. Load target < 2 s for 30 days on demo data; summary tables only (never scan raw inspections for range KPIs
except today).

### 18.6 CAPA Escalation Board (`/d/capa`)

- Columns: Open · Investigating · Action · Verification · Closed (last 14 days only; older via list view).
- Card: ref, title (2 lines), severity badge, source chip (inspection/audit/claim), line/order, owner avatar + name,
  due countdown (`in 2d 4h` / `overdue 1d 3h`), escalation tag ("Escalated → QA Manager"), progress (actions done/total).
  Overdue: red border + subtle glow (`box-shadow` animation 2 s, respects `prefers-reduced-motion`).
- Drag between columns (native HTML5 DnD on desk) → `POST /capas/:id/transition`; if required fields are missing the
  card snaps back and a modal asks for them (e.g. root cause + 5-Why). Reorder within a column updates `board_position`
  (fractional indexing: midpoint between neighbours).
- Touch devices: no drag; a status dropdown on the card.
- Filters: owner, unit, severity, source, "only overdue", "mine". Live updates via `capa:<factoryId>` SSE.
- CAPA detail: header + workflow stepper, 5-Why editor (up to 5 rows), containment/corrective/preventive fields,
  actions checklist with owners & due dates, comments thread, linked NCR/source with photos, history.

### 18.7 Defect Photo Wall (`/d/photos`)

- Masonry-like CSS grid (fixed aspect thumbs 4:3 `object-fit: cover`), 6 columns on 1440 px.
- Overlay on hover: defect code + severity chip, line, date. Badge for archived.
- FilterBar: date range, unit, line, stage, defect code (multi), severity, buyer, style, order.
- Infinite scroll with `IntersectionObserver`, cursor pagination, `loading="lazy"` + explicit width/height (no layout shift).
- Lightbox: full image (or thumb + "archived" note), keyboard ←/→/Esc, side panel with inspection ref link, defect
  details, inspector, operator, zone; "Open inspection", "Raise NCR".
- "Group by defect" toggle → sections per defect code with counts (useful for training).

### 18.8 Buyer Audit Pack (`/d/orders/:id` → generate → `/print/audit-pack/:snapshotId`)

**Snapshot payload** (frozen JSON, sha256 of canonical JSON stored):
1. Cover: factory logo/name, buyer, order no, style, quantity, ship date, generated by/at, snapshot ref (`PACK-...`), hash (short).
2. Executive summary: total inspections by stage, overall DHU, FPY, AQL lots pass/fail, concessions (failed-but-released, red).
3. Material quality: fabric rolls with 4-point scores, shade groups, trims incoming results, lab tests.
4. Production quality: endline DHU per line for this order (table + small bar chart), top defects Pareto.
5. Measurements: summary of out-of-tolerance points per size.
6. Final audits: each AQL inspection with snapshot (level, sample, Ac/Re, found, verdict, inspector, date), re-inspections chain.
7. CAPA: NCRs/CAPAs linked to this order with root cause and status.
8. Instruments: calibration status of instruments used (those in scope units) at generation time.
9. Traceability appendix: carton list with codes and their source rolls/lines.
10. Defect photo appendix: up to 24 representative thumbs (critical/major first).

**Print page:** A4, section page breaks, running header (factory, order, "Audit Pack"), footer (snapshot ref + hash +
page), tables with repeated headers, charts as SVG (print crisp). Button bar (hidden in print): Print / Save as PDF,
Download CSV bundle (raw tables). Snapshots are immutable; regenerate creates a new snapshot.

### 18.9 AI Quality Report (`/d/reports/ai`) — added in 1.1

**Data (no AI needed):** for the selected factory/unit/date range, computed from summary tables + inspections:
total inspected, total defects, defect %, each with delta vs the previous period of equal length; defects by garment
zone (from defect `zone`, shown on the garment outline); defect types by category; top 5 defect codes; defect % trend
per day (this period vs previous); **estimated losses**.

**Estimated losses** (uses `inspections.cost_per_piece`, never guessed):
- Scrap = rejected pieces (defects with `rework_status = 'rejected'`) × cost per piece.
- Rework = reworked/defective pieces not scrapped × cost per piece × `settings.loss_model.rework_cost_pct` / 100.
- Customer claims = `claims.amount` received in the period (same currency only).
- No "delay penalty" in Phase A (no data source). The card states "Estimated — based on cost per piece entered on each
  check". `rework_cost_pct` default 15 % is labelled "default — confirm with client".

**AI insights (DeepSeek):**
- Server-side only: `services/aiReport.ts` calls `POST {DEEPSEEK_BASE_URL}/chat/completions` with Node's built-in `fetch`
  (no SDK, no new dependency), model `DEEPSEEK_MODEL`, JSON output mode, 30 s timeout, 1 retry.
- Input: only the aggregated numbers above, line/unit codes, defect codes/names, lot numbers. **Never** people's names,
  usernames, photos, or free-text remarks.
- Output (validated with a shared validator; invalid output = error, never shown raw): `whyItHappened[]`,
  `howToMitigate[]`, `areasToImprove[]`, `likelyRootCauses[{title, evidence, confidence: high|medium|low}]`,
  `overallRecommendation`. Every claim must cite a number from the input; the prompt says so and the UI labels the
  panel "AI-generated — verify before acting".
- Reports are generated on demand ("Generate insights") as a job, stored in `report_snapshots` (`report_type = 'ai_quality'`,
  payload = input + output + model + generated_at) and shown from the snapshot afterwards. Rate limit: 10 per factory per hour.
- If `DEEPSEEK_API_KEY` is empty or the call fails, the data panels still work and the AI panel shows
  "AI insights unavailable" with the last successful snapshot, if any.
- Permission: `reports.view` to see, new permission `reports.ai.generate` to generate. "Export Full Report" → print page.

---

## 19. Department modules (14) — detailed specs

Each module = seed templates (stage + type) + any stage-specific widgets. Build the generic engine first; modules are mostly
templates. Seed one complete, realistic template per row below (English labels). Mark seed templates as "Sample — adapt to
your buyers".

| # | Module (stage) | Inspection types | Capture mode | Specific behaviour |
|---|---|---|---|---|
| 1 | Sample Development (`sample`) | `sample_review`, `measurement` | checklist + measurement | Sample type select (Proto, Fit, Size Set, PP, TOP, Shipment sample), revision no., buyer comments, approval status (Approved / Approved with comments / Rejected), measurement vs style spec |
| 2 | Trims & Accessories (`trims`) | `incoming` | aql (trims AQL rule) + checklist | Subject = trims batch; check vs approved trim card (colour, size, logo, function), quantity verification, supplier recorded; fail → supplier NCR |
| 3 | Fabric Inspection (`fabric`) | `four_point`, `shade`, `lab`, `incoming` | four_point / checklist | Subject = fabric roll; 4-point scoring §8.4; actual width/length vs ticket; shade band (A/B/C) + shade group; lab tests via `lab_tests` (GSM, shrinkage, colour fastness) |
| 4 | Cutting (`cutting`) | `marker`, `spreading`, `bundle_audit` | checklist / pieces | Marker check (length, efficiency, pattern match), spreading (plies, tension, alignment, ends), bundle audit (sample pieces per bundle, defects, measurement), wastage % field; generates bundles + codes |
| 5 | Fusing (`fusing`) | `process_check` | checklist | Machine ID, temperature/pressure/time with target ± tolerance (number fields with tol → auto fail), bond strength (peel) test, rejects count |
| 6 | Printing (`printing`) | `process_check`, `endline` | checklist + pieces | Artwork approval ref, placement measurement, cure test, rub test, defects on garment canvas |
| 7 | Embroidery (`embroidery`) | `process_check`, `endline` | checklist + pieces | Design/approval ref, thread colours, stitch density/registration, machine ID & head, defects (thread break, puckering, misregistration) |
| 8 | Washing (`washing`) | `process_check`, `lab`, `endline` | checklist + pieces | Recipe/batch no., wash type, chemicals list, pH, shrinkage, shade vs approved standard, measurement after wash |
| 9 | Sewing (`sewing`) | `inline` (TLS), `endline` | tls / pieces | §8.2, §8.3, operator-level defects, rework status, hourly stats → heatmap |
| 10 | Finishing (`finishing`) | `measurement`, `metal_detection`, `endline` | measurement / checklist / pieces | Measurement checks; labels (care, size, brand, country) check; ironing/pressing check; metal detection log: machine, calibration test pieces (Fe 1.0/1.2 mm etc. — values configurable) checked every N hours, pass/fail, detected pieces quarantined |
| 11 | Packing (`packing`) | `carton_audit` | checklist | Subject = carton; scan carton code; assortment vs packing list, quantity, poly/label/hangtag, carton marks, barcode/UPC match (scan), weight; re-pack log on fail |
| 12 | Final Audit (`final_audit`) | `pre_final`, `aql_final`, `re_inspection` | aql | §8.1, §8.6, §18.4; carton selection list (random cartons suggested by system: √n cartons rule shown as guidance, configurable) |
| 13 | FG & Shipment (`fg_shipment`) | `stock_qc`, `loading` | checklist | Stock QC (storage, carton condition, humidity); loading: container no., seal no., container condition checklist, photos at 0%/50%/100% loaded (required photo fields), release sign-off; sets order `shipped` |
| 14 | Common QMS (`qms`) | registers | n/a | Documents (versioned SOPs, approval, review due), Calibration (instruments, records, due/overdue), Training (sessions, attendance, results), Audits (internal/buyer/3rd party, findings → NCR), Claims (buyer claims → NCR), Lab tests register |

**Default defect library seed** (global, English, ~80 codes). Categories and examples (codes `CAT-NN`):
- SEW: broken stitch, skip stitch, open seam, puckering, uneven stitch, wrong SPI, raw edge, pleat, twisted seam,
  high-low, uncut thread (minor), needle mark, wavy seam, label misplacement, button missing, button broken, buttonhole
  defect, bartack missing, zipper defect, run-off stitch.
- FAB: hole (is_hole), slub, thick/thin yarn, knot, stain from mill, colour variation, barre, crease mark, missing yarn,
  bowing/skew, contamination.
- SPOT: oil stain, dirt spot, chalk mark, glue mark, water mark.
- SHADE: shade variation within garment, panel shading.
- MEAS: measurement out of tolerance (+), measurement out of tolerance (−).
- PRINT: misprint, crack, smudge, placement, peeling, colour off.
- EMB: thread break, puckering, misregistration, wrong colour, loose thread.
- WASH: uneven wash, hard hand-feel, damage/torn, shade off.
- FIN: ironing shine, crease, wrong label, missing label, wrong size label, hangtag missing.
- PACK: wrong assortment, wrong qty, poly bag damage, wrong carton mark, barcode mismatch.
- CRIT: needle/metal found, sharp object, wrong care label (safety), mould.
Defaults: CRIT → critical; holes, open seam, broken stitch, stains on front → major; uncut thread, minor marks → minor.
Names must use standard garment-QA English terms; flag any uncertain naming in a comment for client review.

---

## 20. Seed data and demo data

### 20.1 `seed:base` (idempotent, safe in production)
Permissions, roles, role_permissions, global defect library, AQL tables, garment templates, default escalation rules,
sample checklist templates (one per module row in §19, published version 1). Creates a Super Admin from env
`SEED_ADMIN_USERNAME` / `SEED_ADMIN_PASSWORD` (must_change_password = true) if no users exist.

### 20.2 `seed:demo` (dev/demo only; refuses to run if `NODE_ENV=production` unless `--force`)
Purpose: realistic data for screenshots and demos. Deterministic (seeded PRNG, `--seed=42`).

- Factory: "Demo Apparels Ltd." code `DA`, timezone Asia/Dhaka; 2 units (U1 Knit, U2 Woven); 24 sewing lines (12 each),
  2 cutting tables, 2 finishing sections, packing; 2 shifts.
- ~600 operators with plausible Bangladeshi names (generated from first/last name lists; not real people).
- 4 fictional buyers ("Northwind Apparel", "Bluefjord", "Casa Verde", "Urban Loom") with quality rules.
- 6 suppliers, 12 styles across garment types, 20 orders (various statuses; 6 shipped).
- 60 days of data per working day (Sat–Thu):
  - Endline inspections every hour per line; checked 100–180 pcs/hour; DHU per line drawn from line "personality"
    (4 good lines ~1.5–2.5, most 2.5–4.5, 3 problem lines 5–9) with Monday-equivalent (Saturday) spike +15%, and a
    gradual improvement of ~25% over the 60 days ("system go-live effect") — this makes the trend chart tell a story.
  - Inline TLS rounds (some reds clustered on problem lines/operators).
  - Fabric rolls with 4-point inspections (90% pass), trims incoming, cutting bundles, cartons, final AQL audits
    (~88% pass, some re-inspections, 2 concessions), loading for shipped orders.
  - Defects with realistic Pareto (top 5 codes ≈ 60%), positions concentrated in plausible zones (e.g. broken stitch on
    side seams/armholes, stains on front body).
  - 45 NCRs, CAPAs spread across columns, 6 overdue at different escalation levels.
  - QMS: 30 documents, 40 instruments (3 overdue), 12 trainings, 5 audits with findings, 4 claims, lab tests.
- Photos (no image library is allowed on the server, so the seed never resizes images):
  - If `db/seed/photos/full/*.jpg|webp` exist (user-provided real defect photos, already ≤ 1600 px), copy them into
    storage and assign them cyclically to major/critical defects. If a matching `db/seed/photos/thumbs/<same name>`
    exists use it as the thumbnail, otherwise point `thumb_path` at the full image.
  - If no photos are provided, write small neutral SVG placeholder tiles (defect code + zone text on a fabric-coloured
    background) with `mime = image/svg+xml`, demo only. The seed writes these directly to storage; they never pass
    through the upload endpoint.
  - Record which option was used in PROGRESS.md and tell the user that real sample photos make the Photo Wall
    screenshot far more convincing.
- Demo users (password `Demo@1234`, must_change_password=false): `admin`, `qa.manager`, `qa.exec`, `inspector1..6`,
  `supervisor1..2`, `prod.manager`, `gm`, `merch.northwind`, `lab1`.
- A display token for U1 printed to the console.
- Live simulator: `npm run demo:live` keeps inserting endline inspections every few seconds for U1 lines (through the
  real service layer) so the heatmap animates during live demos.

### 20.3 Screenshot checklist (do at Milestone 15)
Produce `docs/SCREENSHOTS.md` listing exact URL, viewport (1440×900 desk, 1280×800 tablet landscape, 390×844 phone),
user, and filters for each of the 8 showcase screens.

---

## 21. Milestones, build order and acceptance criteria

Each milestone ends with typecheck/lint/tests passing, manual verification, PROGRESS.md update, and a stop for review.

**M0 — Foundation**
Workspaces, tsconfig, eslint/prettier, Vite app shell rendering "Hello", Express app with `/health`, pg pool,
migration runner with checksums, `0001_extensions_enums.sql`, `db:reset`, env config validation, docker-compose
(postgres, api, nginx serving built web, `/api` proxy, SSE-safe config), `.env.example`, `docs/PROGRESS.md`, `docs/DECISIONS.md`.
✅ `docker compose up` serves the web app and `/api/v1/health` returns db ok. `npm run dev` hot-reloads both.

**M1 — Platform core**
Migrations for org, users, roles, permissions, scopes, refresh tokens, audit_log + triggers, idempotency, jobs, ref_counters.
Auth (login/refresh/logout/change password, lockout), auth middleware, permission + scope helpers, error handler,
request id, security headers, CORS, validators library, idempotency middleware, logger, worker skeleton.
Web: apiClient, dataSource, useQuery/useMutation, i18n, design tokens, all base components + `/dev/components`,
FloorLayout & DeskLayout, guards, login & change password screens, Me page.
Admin: users, roles (permission matrix), org tree, shifts, operators (+CSV import), settings.
✅ Tests: login/refresh rotation/reuse detection; permission denial; scope isolation by id; idempotent replay;
version conflict; audit_log row written with user id. Manual: create users, log in as inspector → Floor shell, as GM → Desk.

**M2 — Master data**
Buyers + quality rules, suppliers, styles + measurement grid + CSV import, orders + breakdown, global search.
✅ CRUD with versions, soft delete, CSV import with row-level error report.

**M3 — Configuration engine**
Template schema types + validators; Checklist Builder with live preview; versioning + publish + immutability trigger;
`ChecklistRenderer`; defect library (+ seed); garment templates (draw SVGs + zones) + `GarmentCanvas` read-only;
AQL tables seed + admin + `/aql/resolve`; `seed:base`.
✅ Builder can create a template with every field type and showIf; published version cannot be edited (DB rejects);
AQL fixture tests pass; zone hit-testing tests pass for every garment type (sample points per zone).

**M4 — Inspection core (Sewing endline first)**
Inspections tables, start wizard, capture screen (pieces mode + defect sheet + tap-on-garment), draft engine
(localStorage + server, lock, takeover, restore), back guard, photo pipeline (compression, IndexedDB queue, upload API,
storage, protected serving), review & submit, server-side recompute, ref numbers, state machine, line_hourly upserts,
inspection list & detail (desk).
✅ Manual: kill the tab mid-inspection → reopen → exact state restored. Turn off network → keep capturing → "saved on
this device" → network on → syncs. Same draft on second device → locked notice → takeover works. Duplicate submit
(retry) creates no duplicates. Logging a repeat defect takes ≤ 3 taps. Tests for DHU/FPY calc and submit idempotency.

**M5 — Live Line Heatmap**
LISTEN/NOTIFY, SSE hub with tickets, client EventSource with reconnect & polling fallback, `/lines/live`, heatmap
desk page + drawer, wall display with tokens, `demo:live` simulator (can come with M15 but basic version here).
✅ Submit on tablet → tile updates on PC in < 3 s; killing the API and restarting → clients reconnect automatically.

**M6 — Final AQL audit**
AQL capture mode, verdict calc server-side, hold/release/concession/re-inspection, approval rules, verdict screen.
✅ Fixture-based tests for verdicts incl. critical zero tolerance, 100% inspection, mixed AQL sample sizes.

**M7 — Traceability**
Rolls, trims, cutting lays, bundle generation, cartons bulk creation, shipments, codes, trace links, label print page
(ask user to approve `qrcode` package here), scan screen (BarcodeDetector + wedge + manual), trace API (recursive CTE),
trace timeline (floor) + explorer (desk).
✅ Scanning a carton shows the full chain back to supplier with inspections at each step (seeded scenario).

**M8 — Remaining stage modules**
TLS mode, four-point mode, measurement mode, checklist-only flows; seed templates for all 14 modules; module-specific
fields (§19); lab tests linkage; loading sets order shipped.
✅ An inspection of every type can be started, captured, submitted and viewed. 4-point and tolerance tests pass.

**M9 — NCR & CAPA**
NCR from inspection/audit/claim/manual, CAPA workflow with validations, board with DnD + touch fallback, detail page,
escalation job, notifications (bell, list, SSE), due-soon.
✅ Overdue CAPA escalates level by level per rules (test with time travel by setting due_at in the past);
invalid transitions rejected with clear messages.

**M10 — Command Center & reports**
daily stats job, `/dashboard`, in-house charts, Command Center page, reports center, CSV exports (UTF-8 with BOM),
operator performance.
✅ Dashboard < 2 s on demo data; numbers match a hand-computed SQL check for 3 random days (write that check as a test).

**M10b — AI Quality Report**
§18.9: report data API, loss estimates, DeepSeek client + prompt + output validator, snapshot storage, report page.
✅ Loss numbers match a hand-computed test; invalid/failed AI responses never break the page; no personal data in the
request payload (test asserts on the exact payload).

**M11 — Photo Wall**
Photos list API with cursor, wall page, lightbox, group by defect.
✅ Scrolling 5,000 photos stays smooth; filters combine correctly.

**M12 — QMS core**
Documents/revisions with approval and file upload, instruments & calibration (due/overdue job), trainings & attendance,
audits & findings → NCR, claims → NCR, lab tests register.
✅ Each register supports create/edit/list/filter/export; due/overdue states change via job.

**M13 — Buyer Audit Pack**
Snapshot builder, hashing, print page with all sections, CSV bundle, snapshots list.
✅ Printing to PDF from Chrome produces clean A4 pages with correct breaks; snapshot content does not change after source data changes.

**M14 — Retention, archiving, ops hardening**
ZIP writer (+ tests: produced ZIP opens in OS unzip tools; CRCs match), archive scan/order/restore, archived photo UI,
backup script + OPERATIONS.md restore drill, load test script (`scripts/loadtest.ts`: 400 virtual users mixing draft saves,
submits, heatmap/dashboards reads for 10 min, reports p50/p95/p99 and error rate), performance fixes from results.
✅ p95 < 500 ms for draft saves and submits, dashboard p95 < 2 s, 0 errors at target load on a 4 vCPU / 8 GB VPS profile;
archive + restore round-trip verified.

**M15 — Demo data & polish**
`seed:demo`, `demo:live`, empty states, skeletons, error states, accessibility pass (keyboard nav desk, focus rings,
contrast AA), defect-library review list, SCREENSHOTS.md, final README.
✅ All 8 showcase screens look complete and convincing with demo data at the specified viewports.

---

## 22. Testing, performance and operations

### 22.1 Tests (`node:test` via `tsx --test`)
- `packages/shared`: 100% branch coverage target for `calc/*` and `validators/*` (AQL, DHU/FPY, TLS, 4-point, tolerance,
  zones, template validation, answers validation).
- API integration tests: run against a real Postgres test database (`DATABASE_URL_TEST`), each test file in a transaction
  rolled back, or a fresh schema per run. Cover auth, scope, idempotency, versions, workflows, submit recompute, stats upserts,
  escalation, archive.
- Web: test pure logic (draft merge rules, upload queue state machine, fractional indexing, nice-number axis ticks) with node:test.
- A test that `en.json` has no empty values and contains every key referenced in code.
- A grep test for unsafe SQL interpolation in `repos/`.

### 22.2 Performance rules
- Every list query uses indexes (check `EXPLAIN` for the 10 main queries; document in DECISIONS.md).
- Dashboards read only summary tables (+ today's hourly).
- API compression: let Nginx gzip JSON; no compression middleware.
- Web: route-level code splitting; images lazy; avoid re-render storms in capture screen (memoize canvas, pins as
  separate layer).
- pg pool size 20; statement timeout 15 s (`SET statement_timeout` on connect); idle in transaction timeout 30 s.

### 22.3 Environment variables (`.env.example`)
```
NODE_ENV=development
APP_NAME=Garments TQM
PORT=4000
DATABASE_URL=postgres://tqm:tqm@localhost:5432/tqm
DATABASE_URL_TEST=postgres://tqm:tqm@localhost:5432/tqm_test
JWT_SECRET=change-me-to-32+-random-bytes
ACCESS_TOKEN_TTL_SEC=900
REFRESH_TOKEN_TTL_DAYS=30
UPLOAD_DIR=./data/uploads
ARCHIVE_DIR=./data/archive
WORKER_ENABLED=true
CORS_DEV_ORIGIN=http://localhost:5173
SEED_ADMIN_USERNAME=admin
SEED_ADMIN_PASSWORD=ChangeMe@123
PUBLIC_BASE_URL=http://localhost:5173
LOG_LEVEL=info
```
`config.ts` validates all at startup and exits with a clear message if anything is missing/invalid.

### 22.4 Deployment (`deploy/`)
- `docker-compose.yml`: `db` (postgres:16, volume, healthcheck), `api` (Node 22 alpine, runs migrations on start then
  server; volumes for uploads/archive), `web` (nginx with built assets + config). Restart policies, resource limits.
- `nginx.conf`: serve SPA with `try_files $uri /index.html`; `/api/` proxy to api with `proxy_http_version 1.1`;
  SSE locations (`/api/v1/stream`, `/api/v1/display/stream`) with `proxy_buffering off; proxy_cache off;
  proxy_read_timeout 1h;`; `client_max_body_size 25m`; `location /_protected/uploads/ { internal; alias /data/uploads/; }`;
  gzip for json/js/css/svg; long cache for hashed assets, no-cache for `index.html`; security headers duplicated for static.
- TLS via the host (certbot or provider) — document in OPERATIONS.md.

---

## 23. Out of scope (do not build now) and Phase B notes

**Out of scope for Phase A:** offline capture & sync, service worker, Capacitor packaging, kiosk configuration,
ERP connectors, buyer portal, S3/object-storage archive targets, SMS/WhatsApp notifications, IoT/machine integrations,
dedicated scanner SDKs, multi-factory rollout tooling beyond the data model, formal certifications, native push.

**Phase B (for awareness only, do not implement):**
- Wrap the Vite build with Capacitor (Android first); deploy tablets in kiosk mode.
- Add `dataSource.offline.ts`: local store (IndexedDB or Capacitor SQLite), outbox of mutations with their idempotency
  keys, `GET /sync/pull?since=&entities=` and `POST /sync/push` endpoints, conflict policy per entity (drafts: last-writer
  by `clientUpdatedAt` within lock; submitted records: server wins, client receives conflict), master-data snapshot
  versions. Everything in §3 exists to make this possible — do not violate those rules.

---

## 24. Open questions — make configurable, never guess

These depend on the client. Implement as settings/seed data with clear "default — confirm with client" labels:

1. Exact name and workflow of module 12 (CTP / Cut-to-Pack / Final Audit) → `stage_labels`, template.
2. Buyer-specific AQL levels, inspection levels, 4-point limits, measurement tolerances → `buyer_quality_rules`.
3. DHU colour thresholds → settings.
4. Whether inspections need supervisor approval per stage → settings.
5. Defect code list and wording → defect library (editable).
6. Number of factories/units/lines, user roles and daily inspection volume → org setup + load test parameters.
7. Photo retention period and archive location → settings + `ARCHIVE_DIR`.
8. Metal detector test piece sizes and check frequency → finishing template fields.
9. Carton sampling rule for final audit → settings.
10. ERP integration (not in Phase A) — keep `orders`/`styles` import via CSV for now.

If a new ambiguity appears during implementation, add it here and ask the user.
