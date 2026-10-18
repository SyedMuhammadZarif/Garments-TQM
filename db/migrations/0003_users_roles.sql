-- 0003: users and access (SPEC §7.4). Users are global; factory membership comes from user_scopes (0004).

create table users (
  id uuid primary key,
  username citext not null unique,
  full_name text not null,
  phone text,
  email citext,
  password_hash text not null,
  must_change_password boolean not null default true,
  locale text not null default 'en' check (locale in ('en')),
  preferred_shell shell,
  is_active boolean not null default true,
  is_super_admin boolean not null default false,
  last_login_at timestamptz,
  avatar_path text,
  failed_login_count integer not null default 0,
  locked_until timestamptz,
  version integer not null default 1,
  created_at timestamptz not null default now(),
  created_by uuid references users(id),
  updated_at timestamptz not null default now(),
  updated_by uuid references users(id),
  deleted_at timestamptz
);
create index users_created_by_idx on users (created_by);
create index users_updated_by_idx on users (updated_by);
create index users_username_trgm on users using gin ((username::text) gin_trgm_ops);
select attach_std_triggers('users');

create table roles (
  id uuid primary key,
  key text not null unique check (key ~ '^[a-z][a-z0-9_]*$'),
  name text not null,
  default_shell shell not null,
  is_system boolean not null default false,
  version integer not null default 1,
  created_at timestamptz not null default now(),
  created_by uuid references users(id),
  updated_at timestamptz not null default now(),
  updated_by uuid references users(id),
  deleted_at timestamptz
);
create index roles_created_by_idx on roles (created_by);
create index roles_updated_by_idx on roles (updated_by);
select attach_std_triggers('roles');

create table permissions (
  key text primary key,
  description text not null,
  area text not null
);

create table role_permissions (
  role_id uuid not null references roles(id) on delete cascade,
  permission_key text not null references permissions(key) on delete cascade,
  primary key (role_id, permission_key)
);
create index role_permissions_permission_idx on role_permissions (permission_key);

create table user_roles (
  user_id uuid not null references users(id) on delete cascade,
  role_id uuid not null references roles(id) on delete cascade,
  primary key (user_id, role_id)
);
create index user_roles_role_idx on user_roles (role_id);

create table refresh_tokens (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id),
  family_id uuid not null,              -- the access token's `sid`; one family per login
  token_hash text not null unique,      -- sha256 of the token; the token itself is never stored
  device_id text not null,
  user_agent text,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  revoked_at timestamptz,
  replaced_by uuid references refresh_tokens(id)
);
create index refresh_tokens_user_device_idx on refresh_tokens (user_id, device_id);
create index refresh_tokens_family_idx on refresh_tokens (family_id);

create table login_attempts (
  id bigserial primary key,
  username citext,
  ip inet,
  success boolean not null,
  at timestamptz not null default now()
);
create index login_attempts_ip_idx on login_attempts (ip, at);
create index login_attempts_username_idx on login_attempts (username, at);
