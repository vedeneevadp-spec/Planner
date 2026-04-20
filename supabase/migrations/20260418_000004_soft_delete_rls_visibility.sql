-- Allow authenticated members to keep operating on task tombstones.
-- Application queries still filter deleted rows explicitly.

drop policy if exists tasks_select_member on app.tasks;
create policy tasks_select_member
on app.tasks
for select
to authenticated
using (
  (select app.workspace_is_accessible(workspace_id))
);

drop policy if exists task_time_blocks_select_member on app.task_time_blocks;
create policy task_time_blocks_select_member
on app.task_time_blocks
for select
to authenticated
using (
  (select app.workspace_is_accessible(workspace_id))
);
