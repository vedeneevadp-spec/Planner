-- noinspection SqlNoDataSourceInspection
drop policy if exists emoji_sets_select_admin_including_deleted on app.emoji_sets;
create policy emoji_sets_select_admin_including_deleted
on app.emoji_sets
for select
to authenticated
using (
  (select app.can_manage_global_emoji_library())
);

drop policy if exists emoji_assets_select_admin_including_deleted on app.emoji_assets;
create policy emoji_assets_select_admin_including_deleted
on app.emoji_assets
for select
to authenticated
using (
  (select app.can_manage_global_emoji_library())
);
