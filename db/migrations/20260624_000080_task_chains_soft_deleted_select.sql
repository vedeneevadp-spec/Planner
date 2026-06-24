-- noinspection SqlNoDataSourceInspection

drop policy if exists task_chains_select_deleted_writer on app.task_chains;
create policy task_chains_select_deleted_writer
on app.task_chains
for select
to authenticated
using (
  (select app.workspace_has_write_access(workspace_id))
  and deleted_at is not null
);
