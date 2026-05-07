-- noinspection SqlNoDataSourceInspection
do $$
begin
  if not exists (
    select 1
    from pg_type as type
    inner join pg_namespace as namespace
      on namespace.oid = type.typnamespace
    where namespace.nspname = 'app'
      and type.typname = 'workspace_kind'
  ) then
    create type app.workspace_kind as enum ('personal', 'shared');
  end if;

  if not exists (
    select 1
    from pg_type as type
    inner join pg_namespace as namespace
      on namespace.oid = type.typnamespace
    where namespace.nspname = 'app'
      and type.typname = 'workspace_group_role'
  ) then
    create type app.workspace_group_role as enum (
      'group_admin',
      'senior_member',
      'member'
    );
  end if;
end;
$$;

alter table app.workspaces
  add column if not exists kind app.workspace_kind not null default 'personal';

alter table app.workspace_members
  add column if not exists group_role app.workspace_group_role;

update app.workspaces
set kind = 'personal'
where kind is null;

create unique index if not exists workspaces_one_personal_owner_idx
  on app.workspaces (owner_user_id)
  where kind = 'personal' and deleted_at is null;

create index if not exists workspaces_owner_kind_idx
  on app.workspaces (owner_user_id, kind)
  where deleted_at is null;

create index if not exists workspace_members_group_role_idx
  on app.workspace_members (workspace_id, group_role)
  where group_role is not null and deleted_at is null;
