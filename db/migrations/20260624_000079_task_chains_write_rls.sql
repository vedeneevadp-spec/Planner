-- noinspection SqlNoDataSourceInspection

drop policy if exists task_chains_insert_member on app.task_chains;
create policy task_chains_insert_member
on app.task_chains
for insert
to authenticated
with check (
  (select app.workspace_has_write_access(workspace_id))
  and created_by = (select app.current_user_id())
  and updated_by = (select app.current_user_id())
);

drop policy if exists task_chains_update_member on app.task_chains;
create policy task_chains_update_member
on app.task_chains
for update
to authenticated
using (
  (select app.workspace_has_write_access(workspace_id))
)
with check (
  (select app.workspace_has_write_access(workspace_id))
  and updated_by = (select app.current_user_id())
);

drop policy if exists task_chains_delete_member on app.task_chains;
create policy task_chains_delete_member
on app.task_chains
for delete
to authenticated
using (
  (select app.workspace_has_write_access(workspace_id))
);
