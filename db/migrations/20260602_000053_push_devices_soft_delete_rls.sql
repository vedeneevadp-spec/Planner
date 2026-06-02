drop policy if exists push_devices_select_self on app.push_devices;
create policy push_devices_select_self
on app.push_devices
for select
to authenticated
using (
  (select app.current_user_id()) = user_id
  and (select app.workspace_is_accessible(workspace_id))
);
