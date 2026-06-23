# Time migration report

Date: 2026-06-23

This repository change adds the migration needed for Time System v1. The live data counts must be produced against the target PostgreSQL database immediately before applying the migration.

## Pre-migration count queries

```sql
select count(*) as date_only_tasks
from app.tasks task
where task.deleted_at is null
  and coalesce(task.planned_on, task.due_on) is not null
  and not exists (
    select 1
    from app.task_time_blocks block
    where block.task_id = task.id
      and block.workspace_id = task.workspace_id
      and block.deleted_at is null
  );
```

```sql
select count(*) as tasks_with_inferred_timezone
from app.tasks task
where task.deleted_at is null
  and coalesce(task.planned_on, task.due_on) is not null
  and exists (
    select 1
    from app.task_time_blocks block
    where block.task_id = task.id
      and block.workspace_id = task.workspace_id
      and block.deleted_at is null
  );
```

```sql
select count(*) as potentially_dangerous_utc_midnight
from app.tasks task
join app.task_time_blocks block
  on block.task_id = task.id
 and block.workspace_id = task.workspace_id
 and block.deleted_at is null
where task.deleted_at is null
  and block.timezone = 'UTC'
  and to_char(block.starts_at at time zone 'UTC', 'HH24:MI') in ('00:00', '12:00');
```

```sql
select count(*) as cannot_classify_automatically
from app.tasks task
where task.deleted_at is null
  and coalesce(task.planned_on, task.due_on) is null
  and not exists (
    select 1
    from app.task_time_blocks block
    where block.task_id = task.id
      and block.workspace_id = task.workspace_id
      and block.deleted_at is null
  );
```

## Classification rules used by migration

- Date without a primary time block becomes `time_kind = 'date_only'`, `local_date = coalesce(planned_on, due_on)`.
- Date with a primary time block becomes `time_kind = 'fixed_zone_datetime'`.
- Timed tasks without a stored IANA timezone infer it from `users.default_time_zone`, then `workspaces.default_time_zone`, then `Europe/Astrakhan`, then emergency `UTC`.
- `created_at`, `updated_at`, `completed_at`, `deleted_at` remain absolute instants and are not changed.
- Unscheduled tasks remain with `local_date = null`; they need product semantics before a stricter `date_only requires local_date` DB constraint can be enabled.
