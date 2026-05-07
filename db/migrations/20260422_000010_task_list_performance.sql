create index if not exists task_items_workspace_active_created_idx
  on app.tasks (workspace_id, created_at)
  where deleted_at is null;

create index if not exists task_items_workspace_active_status_planned_idx
  on app.tasks (workspace_id, status, planned_on, created_at)
  where deleted_at is null;

create index if not exists task_items_workspace_active_project_created_idx
  on app.tasks (workspace_id, project_id, created_at)
  where deleted_at is null
    and project_id is not null;

create index if not exists task_time_blocks_primary_lookup_idx
  on app.task_time_blocks (workspace_id, task_id, position, starts_at)
  include (ends_at)
  where deleted_at is null;
