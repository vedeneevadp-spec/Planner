-- noinspection SqlNoDataSourceInspection
do $$
begin
  if exists (
    select 1
    from pg_enum as enum_value
    inner join pg_type as enum_type
      on enum_type.oid = enum_value.enumtypid
    inner join pg_namespace as enum_namespace
      on enum_namespace.oid = enum_type.typnamespace
    where enum_namespace.nspname = 'app'
      and enum_type.typname = 'workspace_role'
      and enum_value.enumlabel = 'member'
  ) and not exists (
    select 1
    from pg_enum as enum_value
    inner join pg_type as enum_type
      on enum_type.oid = enum_value.enumtypid
    inner join pg_namespace as enum_namespace
      on enum_namespace.oid = enum_type.typnamespace
    where enum_namespace.nspname = 'app'
      and enum_type.typname = 'workspace_role'
      and enum_value.enumlabel = 'user'
  ) then
    alter type app.workspace_role rename value 'member' to 'user';
  end if;

  if exists (
    select 1
    from pg_enum as enum_value
    inner join pg_type as enum_type
      on enum_type.oid = enum_value.enumtypid
    inner join pg_namespace as enum_namespace
      on enum_namespace.oid = enum_type.typnamespace
    where enum_namespace.nspname = 'app'
      and enum_type.typname = 'workspace_role'
      and enum_value.enumlabel = 'viewer'
  ) and not exists (
    select 1
    from pg_enum as enum_value
    inner join pg_type as enum_type
      on enum_type.oid = enum_value.enumtypid
    inner join pg_namespace as enum_namespace
      on enum_namespace.oid = enum_type.typnamespace
    where enum_namespace.nspname = 'app'
      and enum_type.typname = 'workspace_role'
      and enum_value.enumlabel = 'guest'
  ) then
    alter type app.workspace_role rename value 'viewer' to 'guest';
  end if;
end;
$$;

create or replace function app.workspace_has_write_access(target_workspace_id uuid)
returns boolean
language sql
stable
as $$
  select exists (
    select 1
    from app.workspace_members as membership
    where membership.workspace_id = target_workspace_id
      and membership.user_id = (select app.current_user_id())
      and membership.role in ('owner', 'admin', 'user')
      and membership.deleted_at is null
  )
$$;
