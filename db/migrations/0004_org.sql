-- 0004: organization (SPEC §7.3) and user scopes (§5.4).

create table factories (
  id uuid primary key,
  code text not null unique check (code ~ '^[A-Z0-9]{2,6}$'),
  name text not null,
  legal_name text,
  timezone text not null default 'Asia/Dhaka',
  logo_path text,
  address text,
  settings jsonb not null default '{}',
  version integer not null default 1,
  created_at timestamptz not null default now(),
  created_by uuid references users(id),
  updated_at timestamptz not null default now(),
  updated_by uuid references users(id),
  deleted_at timestamptz
);
create index factories_created_by_idx on factories (created_by);
create index factories_updated_by_idx on factories (updated_by);
select attach_std_triggers('factories');

create table units (
  id uuid primary key,
  factory_id uuid not null references factories(id),
  code text not null,
  name text not null,
  address text,
  version integer not null default 1,
  created_at timestamptz not null default now(),
  created_by uuid references users(id),
  updated_at timestamptz not null default now(),
  updated_by uuid references users(id),
  deleted_at timestamptz
);
create unique index units_factory_code_uq on units (factory_id, code) where deleted_at is null;
create index units_factory_updated_idx on units (factory_id, updated_at);
create index units_created_by_idx on units (created_by);
create index units_updated_by_idx on units (updated_by);
select attach_std_triggers('units');

create table lines (
  id uuid primary key,
  factory_id uuid not null references factories(id),
  unit_id uuid not null references units(id),
  code text not null,
  name text not null,
  line_type text not null default 'sewing' check (line_type in ('sewing', 'finishing', 'cutting', 'packing', 'other')),
  sort_order integer not null default 0,
  is_active boolean not null default true,
  version integer not null default 1,
  created_at timestamptz not null default now(),
  created_by uuid references users(id),
  updated_at timestamptz not null default now(),
  updated_by uuid references users(id),
  deleted_at timestamptz
);
create unique index lines_unit_code_uq on lines (unit_id, code) where deleted_at is null;
create index lines_unit_idx on lines (unit_id);
create index lines_factory_updated_idx on lines (factory_id, updated_at);
create index lines_created_by_idx on lines (created_by);
create index lines_updated_by_idx on lines (updated_by);
select attach_std_triggers('lines');

create table shifts (
  id uuid primary key,
  factory_id uuid not null references factories(id),
  name text not null,
  start_time time not null,
  end_time time not null,
  crosses_midnight boolean not null default false,
  version integer not null default 1,
  created_at timestamptz not null default now(),
  created_by uuid references users(id),
  updated_at timestamptz not null default now(),
  updated_by uuid references users(id),
  deleted_at timestamptz
);
create index shifts_factory_updated_idx on shifts (factory_id, updated_at);
create index shifts_created_by_idx on shifts (created_by);
create index shifts_updated_by_idx on shifts (updated_by);
select attach_std_triggers('shifts');

create table operators (
  id uuid primary key,
  factory_id uuid not null references factories(id),
  unit_id uuid not null references units(id),
  line_id uuid references lines(id),
  code text not null,
  name text not null,
  skill_grade text,
  is_active boolean not null default true,
  version integer not null default 1,
  created_at timestamptz not null default now(),
  created_by uuid references users(id),
  updated_at timestamptz not null default now(),
  updated_by uuid references users(id),
  deleted_at timestamptz
);
create unique index operators_factory_code_uq on operators (factory_id, code) where deleted_at is null;
create index operators_unit_idx on operators (unit_id);
create index operators_line_idx on operators (line_id);
create index operators_factory_updated_idx on operators (factory_id, updated_at);
create index operators_created_by_idx on operators (created_by);
create index operators_updated_by_idx on operators (updated_by);
create index operators_code_trgm on operators using gin (code gin_trgm_ops);
select attach_std_triggers('operators');

-- buyer_id gets its foreign key when buyers arrive (Milestone 2).
create table user_scopes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  factory_id uuid not null references factories(id),
  unit_id uuid references units(id),
  stage stage,
  buyer_id uuid
);
create index user_scopes_user_idx on user_scopes (user_id);
create index user_scopes_factory_idx on user_scopes (factory_id);
create index user_scopes_unit_idx on user_scopes (unit_id);
