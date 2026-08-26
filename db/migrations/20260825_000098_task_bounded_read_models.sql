create index if not exists task_items_workspace_active_cursor_idx
  on app.tasks (workspace_id, created_at, id)
  where deleted_at is null
    and status in ('todo', 'in_progress', 'ready_for_review');

create index if not exists task_items_workspace_closed_cursor_idx
  on app.tasks (workspace_id, created_at desc, id desc)
  where deleted_at is null
    and status in ('done', 'archived');

create index if not exists task_items_workspace_planned_range_cursor_idx
  on app.tasks (
    workspace_id,
    (coalesce(local_date, planned_on)),
    created_at,
    id
  )
  where deleted_at is null;

create index if not exists task_items_workspace_relevant_range_cursor_idx
  on app.tasks (
    workspace_id,
    (
      coalesce(
        local_date,
        planned_on,
        due_on,
        (completed_at at time zone 'UTC')::date
      )
    ),
    created_at,
    id
  )
  where deleted_at is null;
