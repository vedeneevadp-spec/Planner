do $$
begin
  if not exists (
    select 1
    from pg_type as enum_type
    inner join pg_namespace as enum_namespace
      on enum_namespace.oid = enum_type.typnamespace
    where enum_namespace.nspname = 'app'
      and enum_type.typname = 'app_role'
  ) then
    create type app.app_role as enum ('owner', 'admin', 'user', 'guest');
  end if;
end;
$$;

alter table app.users
  add column if not exists app_role app.app_role;

update app.users
set app_role = 'user'
where app_role is null;

with candidate_owner as (
  select workspace.owner_user_id as user_id
  from app.workspaces as workspace
  inner join app.users as owner_user
    on owner_user.id = workspace.owner_user_id
  where workspace.kind = 'personal'
    and workspace.deleted_at is null
    and owner_user.deleted_at is null
  order by workspace.created_at asc, owner_user.created_at asc
  limit 1
)
update app.users
set app_role = 'owner'
where id = (select user_id from candidate_owner);

alter table app.users
  alter column app_role set default 'user';

alter table app.users
  alter column app_role set not null;

create unique index if not exists users_single_owner_idx
  on app.users (app_role)
  where app_role = 'owner' and deleted_at is null;
