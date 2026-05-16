-- noinspection SqlNoDataSourceInspection
create index if not exists tasks_parent_task_active_idx
  on app.tasks (parent_task_id)
  where parent_task_id is not null and deleted_at is null;
