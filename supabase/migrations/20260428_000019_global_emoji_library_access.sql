-- noinspection SqlNoDataSourceInspection
create or replace function app.current_user_app_role()
returns app.app_role
language sql
stable
as $$
  select user_row.app_role
  from app.users as user_row
  where user_row.id = (select app.current_user_id())
    and user_row.deleted_at is null
  limit 1
$$;

create or replace function app.can_manage_global_emoji_library()
returns boolean
language sql
stable
as $$
  select coalesce(
    (select app.current_user_app_role() in ('owner', 'admin')),
    false
  )
$$;

drop policy if exists emoji_sets_select_member on app.emoji_sets;
create policy emoji_sets_select_member
on app.emoji_sets
for select
to authenticated
using (
  (select app.current_user_id()) is not null
  and deleted_at is null
);

drop policy if exists emoji_sets_insert_admin on app.emoji_sets;
create policy emoji_sets_insert_admin
on app.emoji_sets
for insert
to authenticated
with check (
  (select app.can_manage_global_emoji_library())
  and created_by = (select app.current_user_id())
  and updated_by = (select app.current_user_id())
);

drop policy if exists emoji_sets_update_admin on app.emoji_sets;
create policy emoji_sets_update_admin
on app.emoji_sets
for update
to authenticated
using (
  (select app.can_manage_global_emoji_library())
)
with check (
  (select app.can_manage_global_emoji_library())
  and updated_by = (select app.current_user_id())
);

drop policy if exists emoji_sets_delete_admin on app.emoji_sets;
create policy emoji_sets_delete_admin
on app.emoji_sets
for delete
to authenticated
using (
  (select app.can_manage_global_emoji_library())
);

drop policy if exists emoji_assets_select_member on app.emoji_assets;
create policy emoji_assets_select_member
on app.emoji_assets
for select
to authenticated
using (
  (select app.current_user_id()) is not null
  and deleted_at is null
);

drop policy if exists emoji_assets_insert_admin on app.emoji_assets;
create policy emoji_assets_insert_admin
on app.emoji_assets
for insert
to authenticated
with check (
  (select app.can_manage_global_emoji_library())
  and created_by = (select app.current_user_id())
  and updated_by = (select app.current_user_id())
);

drop policy if exists emoji_assets_update_admin on app.emoji_assets;
create policy emoji_assets_update_admin
on app.emoji_assets
for update
to authenticated
using (
  (select app.can_manage_global_emoji_library())
)
with check (
  (select app.can_manage_global_emoji_library())
  and updated_by = (select app.current_user_id())
);

drop policy if exists emoji_assets_delete_admin on app.emoji_assets;
create policy emoji_assets_delete_admin
on app.emoji_assets
for delete
to authenticated
using (
  (select app.can_manage_global_emoji_library())
);
