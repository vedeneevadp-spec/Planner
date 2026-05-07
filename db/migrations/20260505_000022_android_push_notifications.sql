do $$
begin
  if not exists (
    select 1
    from pg_type as enum_type
    inner join pg_namespace as enum_namespace
      on enum_namespace.oid = enum_type.typnamespace
    where enum_namespace.nspname = 'app'
      and enum_type.typname = 'push_platform'
  ) then
    create type app.push_platform as enum ('android');
  end if;
end;
$$;

create table if not exists app.push_devices (
  id uuid primary key default app.uuid_generate_v7(),
  workspace_id uuid not null references app.workspaces(id) on delete cascade,
  user_id uuid not null references app.users(id) on delete cascade,
  platform app.push_platform not null,
  installation_id text not null,
  token text not null,
  device_name text,
  app_version text,
  locale text,
  last_registered_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  version bigint not null default 1,
  unique (platform, installation_id),
  unique (platform, token)
);

create index if not exists push_devices_user_idx
  on app.push_devices (user_id, workspace_id, created_at desc)
  where deleted_at is null;

create index if not exists push_devices_workspace_idx
  on app.push_devices (workspace_id, created_at desc)
  where deleted_at is null;

drop trigger if exists push_devices_bump_row_version on app.push_devices;
create trigger push_devices_bump_row_version
before update on app.push_devices
for each row execute function app.bump_row_version();

grant select, insert, update, delete on table app.push_devices to authenticated;

alter table app.push_devices enable row level security;

drop policy if exists push_devices_select_self on app.push_devices;
create policy push_devices_select_self
on app.push_devices
for select
to authenticated
using (
  (select app.current_user_id()) = user_id
  and (select app.workspace_is_accessible(workspace_id))
  and deleted_at is null
);

drop policy if exists push_devices_insert_self on app.push_devices;
create policy push_devices_insert_self
on app.push_devices
for insert
to authenticated
with check (
  (select app.current_user_id()) = user_id
  and (select app.workspace_is_accessible(workspace_id))
);

drop policy if exists push_devices_update_self on app.push_devices;
create policy push_devices_update_self
on app.push_devices
for update
to authenticated
using (
  (select app.current_user_id()) = user_id
)
with check (
  (select app.current_user_id()) = user_id
  and (select app.workspace_is_accessible(workspace_id))
);

drop policy if exists push_devices_delete_self on app.push_devices;
create policy push_devices_delete_self
on app.push_devices
for delete
to authenticated
using (
  (select app.current_user_id()) = user_id
);
