-- noinspection SqlNoDataSourceInspection
create or replace function app.current_user_app_role()
returns app.app_role
language sql
stable
security definer
set search_path = app, pg_temp
as $$
  select user_row.app_role
  from app.users as user_row
  where user_row.id = (select app.current_user_id())
    and user_row.deleted_at is null
  limit 1
$$;

grant update (app_role) on table app.users to authenticated;

drop policy if exists users_select_owner on app.users;
create policy users_select_owner
on app.users
for select
to authenticated
using (
  (select app.current_user_app_role()) = 'owner'
  and deleted_at is null
);

drop policy if exists users_update_owner on app.users;
create policy users_update_owner
on app.users
for update
to authenticated
using (
  (select app.current_user_app_role()) = 'owner'
  and app_role <> 'owner'
  and deleted_at is null
)
with check (
  (select app.current_user_app_role()) = 'owner'
  and app_role <> 'owner'
  and deleted_at is null
);
