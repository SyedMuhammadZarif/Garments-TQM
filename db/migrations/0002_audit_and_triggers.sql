-- 0002: audit log + shared trigger functions (SPEC §7.1, §7.13).

create table audit_log (
  id bigserial primary key,
  at timestamptz not null default now(),
  factory_id uuid,
  user_id uuid,
  request_id text,
  table_name text not null,
  row_id uuid not null,
  action text not null check (action in ('insert', 'update', 'delete', 'soft_delete')),
  old_data jsonb,
  new_data jsonb,
  changed_fields text[]
);
create index audit_log_row_idx on audit_log (table_name, row_id, at);
create index audit_log_user_idx on audit_log (user_id, at);
create index audit_log_factory_idx on audit_log (factory_id, at);

-- Append-only: the app owns the table, so a trigger (not just REVOKE) is what actually stops edits.
create function audit_log_immutable() returns trigger language plpgsql as $$
begin
  raise exception 'audit_log is append-only';
end $$;
create trigger audit_log_no_update before update or delete on audit_log
  for each statement execute function audit_log_immutable();

create function set_updated_at() returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;

-- Writes one audit_log row per change. withTx() sets app.user_id / app.request_id per transaction.
-- Secrets are never copied into the log.
create function audit_row() returns trigger language plpgsql as $$
declare
  old_j jsonb := case when tg_op in ('UPDATE', 'DELETE') then to_jsonb(old) - 'password_hash' - 'token_hash' end;
  new_j jsonb := case when tg_op in ('INSERT', 'UPDATE') then to_jsonb(new) - 'password_hash' - 'token_hash' end;
  src jsonb := coalesce(new_j, old_j);
  act text := lower(tg_op);
  changed text[];
  uid text := nullif(current_setting('app.user_id', true), '');
  rid text := nullif(current_setting('app.request_id', true), '');
begin
  if tg_op = 'UPDATE' then
    select coalesce(array_agg(k order by k), '{}') into changed
    from jsonb_object_keys(new_j) k
    where k not in ('updated_at', 'version') and (new_j -> k) is distinct from (old_j -> k);
    -- Password changes are stripped from the data but still worth recording as a changed field.
    if to_jsonb(new) ? 'password_hash' and (to_jsonb(new) ->> 'password_hash') is distinct from (to_jsonb(old) ->> 'password_hash') then
      changed := array_append(changed, 'password_hash');
    end if;
    if cardinality(changed) = 0 then
      return new;
    end if;
    if (old_j ->> 'deleted_at') is null and (new_j ->> 'deleted_at') is not null then
      act := 'soft_delete';
    end if;
  end if;

  insert into audit_log (factory_id, user_id, request_id, table_name, row_id, action, old_data, new_data, changed_fields)
  values (
    case when tg_table_name = 'factories' then (src ->> 'id')::uuid else (src ->> 'factory_id')::uuid end,
    uid::uuid, rid, tg_table_name, (src ->> 'id')::uuid, act, old_j, new_j, changed
  );
  return coalesce(new, old);
end $$;

-- Attaches both standard triggers to a table; called by later migrations for every +STD table.
create function attach_std_triggers(tbl regclass) returns void language plpgsql as $$
begin
  execute format('create trigger set_updated_at before update on %s for each row execute function set_updated_at()', tbl);
  execute format('create trigger audit_row after insert or update or delete on %s for each row execute function audit_row()', tbl);
end $$;
