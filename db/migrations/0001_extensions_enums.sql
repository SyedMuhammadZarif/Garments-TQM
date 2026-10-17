-- 0001: extensions and enums (SPEC §7.1, §7.2).
-- Later additions to an enum use ALTER TYPE ... ADD VALUE in a new migration.

create extension if not exists pgcrypto;
create extension if not exists citext;
create extension if not exists pg_trgm;

create type stage as enum (
  'sample', 'trims', 'fabric', 'cutting', 'fusing', 'printing', 'embroidery', 'washing',
  'sewing', 'finishing', 'packing', 'final_audit', 'fg_shipment', 'qms'
);

create type inspection_type as enum (
  'sample_review', 'incoming', 'four_point', 'shade', 'lab', 'marker', 'spreading', 'bundle_audit',
  'process_check', 'inline', 'endline', 'measurement', 'metal_detection', 'carton_audit', 'aql_final',
  'pre_final', 'loading', 'stock_qc', 're_inspection', 'generic'
);

create type inspection_status as enum ('draft', 'submitted', 'approved', 'rejected', 'on_hold', 'released', 'cancelled');
create type inspection_result as enum ('pass', 'fail', 'conditional', 'na');
create type severity as enum ('critical', 'major', 'minor');
create type shell as enum ('floor', 'desk');
create type ncr_status as enum ('open', 'closed', 'cancelled');
create type capa_status as enum ('open', 'investigating', 'action', 'verification', 'closed');
create type entity_type as enum (
  'fabric_roll', 'trims_batch', 'cutting_lay', 'bundle', 'line_output', 'carton', 'shipment', 'order', 'sample'
);
create type job_status as enum ('queued', 'running', 'done', 'failed', 'dead');
create type photo_state as enum ('hot', 'archived');
create type archive_status as enum ('pending', 'writing', 'verifying', 'complete', 'failed', 'restored');
create type doc_status as enum ('draft', 'approved', 'obsolete');
create type audit_type as enum ('internal', 'buyer', 'third_party', 'certification');
create type claim_status as enum ('received', 'investigating', 'accepted', 'rejected', 'settled');
