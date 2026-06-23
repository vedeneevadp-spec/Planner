-- noinspection SqlNoDataSourceInspection

drop policy if exists users_update_self_preferences on app.users;
create policy users_update_self_preferences
on app.users
for update
to authenticated
using (
  (select app.current_user_id()) = id
  and deleted_at is null
)
with check (
  (select app.current_user_id()) = id
  and deleted_at is null
);
