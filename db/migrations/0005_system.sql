-- 0005: idempotency keys, background jobs, reference counters (SPEC §7.7, §7.13).

create table idempotency_keys (
  key uuid not null,
  user_id uuid not null,
  method text not null,
  path text not null,
  request_hash text not null,
  status_code integer,               -- null while the first request is still running
  response_body jsonb,
  created_at timestamptz not null default now(),
  primary key (key, user_id)
);
create index idempotency_keys_created_idx on idempotency_keys (created_at);

create table jobs (
  id bigserial primary key,
  type text not null,
  payload jsonb not null default '{}',
  run_at timestamptz not null default now(),
  priority integer not null default 0,
  status job_status not null default 'queued',
  attempts integer not null default 0,
  max_attempts integer not null default 5,
  locked_at timestamptz,
  locked_by text,
  last_error text,
  created_at timestamptz not null default now(),
  finished_at timestamptz,
  dedupe_key text unique
);
create index jobs_claim_idx on jobs (status, run_at, priority desc);

create table ref_counters (
  factory_id uuid not null references factories(id),
  ref_type text not null,
  year integer not null,
  last_value integer not null default 0,
  primary key (factory_id, ref_type, year)
);
