-- noinspection SqlNoDataSourceInspection

alter table app.users
  add column if not exists default_time_zone text,
  add column if not exists time_zone_mode text not null default 'device',
  add column if not exists last_seen_time_zone text;

alter table app.users
  drop constraint if exists users_time_zone_mode_check;

alter table app.users
  add constraint users_time_zone_mode_check
  check (time_zone_mode in ('device', 'manual', 'workspace'));

alter table app.workspaces
  add column if not exists default_time_zone text;

alter table app.tasks
  add column if not exists time_kind text not null default 'date_only',
  add column if not exists local_date date,
  add column if not exists local_time time,
  add column if not exists time_zone text,
  add column if not exists starts_at_utc timestamptz,
  add column if not exists time_zone_inferred boolean not null default false,
  add column if not exists recurrence_rule text,
  add column if not exists recurrence_time_zone text,
  add column if not exists recurrence_start_date date;

alter table app.tasks
  drop constraint if exists tasks_time_kind_check;

alter table app.tasks
  add constraint tasks_time_kind_check
  check (time_kind in (
    'date_only',
    'fixed_zone_datetime',
    'floating_local_time',
    'instant'
  ));

with primary_time_blocks as (
  select distinct on (block.task_id)
    block.task_id,
    block.workspace_id,
    block.starts_at,
    block.timezone
  from app.task_time_blocks block
  where block.deleted_at is null
  order by block.task_id, block.position asc, block.starts_at asc
),
task_time_migration as (
  select
    task.id,
    coalesce(task.planned_on, task.due_on) as local_date,
    case
      when primary_block.starts_at is null then null::time
      else (primary_block.starts_at at time zone 'UTC')::time
    end as local_time,
    case
      when primary_block.starts_at is null then null::text
      when nullif(primary_block.timezone, '') is not null
        and primary_block.timezone <> 'UTC'
      then primary_block.timezone
      else coalesce(
        nullif(actor.default_time_zone, ''),
        nullif(workspace.default_time_zone, ''),
        'Europe/Astrakhan',
        'UTC'
      )
    end as resolved_time_zone,
    primary_block.starts_at is not null as has_time,
    primary_block.starts_at is not null
      and (
        primary_block.timezone is null
        or primary_block.timezone = ''
        or primary_block.timezone = 'UTC'
      ) as inferred_time_zone
  from app.tasks task
  left join primary_time_blocks primary_block
    on primary_block.task_id = task.id
   and primary_block.workspace_id = task.workspace_id
  left join app.users actor
    on actor.id = task.created_by
  left join app.workspaces workspace
    on workspace.id = task.workspace_id
  where task.local_date is null
    and coalesce(task.planned_on, task.due_on) is not null
)
update app.tasks task
set
  time_kind = case
    when migration.has_time then 'fixed_zone_datetime'
    else 'date_only'
  end,
  local_date = migration.local_date,
  local_time = migration.local_time,
  time_zone = case
    when migration.has_time then migration.resolved_time_zone
    else null
  end,
  starts_at_utc = case
    when migration.has_time then
      (migration.local_date::timestamp + migration.local_time)
        at time zone migration.resolved_time_zone
    else null
  end,
  time_zone_inferred = migration.inferred_time_zone,
  recurrence_time_zone = case
    when migration.has_time then migration.resolved_time_zone
    else task.recurrence_time_zone
  end,
  recurrence_start_date = coalesce(task.recurrence_start_date, migration.local_date)
from task_time_migration migration
where task.id = migration.id;

create index if not exists tasks_local_date_idx
  on app.tasks(local_date);

create index if not exists tasks_starts_at_utc_idx
  on app.tasks(starts_at_utc);

create index if not exists tasks_time_kind_idx
  on app.tasks(time_kind);

create index if not exists tasks_workspace_local_date_idx
  on app.tasks(workspace_id, local_date);

create index if not exists tasks_workspace_starts_at_utc_idx
  on app.tasks(workspace_id, starts_at_utc);

create table if not exists app.task_occurrences (
  id uuid primary key default app.uuid_generate_v7(),
  task_id uuid not null references app.tasks(id) on delete cascade,
  occurrence_date date not null,
  local_time time,
  time_zone text,
  starts_at_utc timestamptz,
  status text not null default 'planned',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists task_occurrences_task_date_idx
  on app.task_occurrences(task_id, occurrence_date);

create index if not exists task_occurrences_starts_at_utc_idx
  on app.task_occurrences(starts_at_utc);

drop trigger if exists task_occurrences_bump_row_version on app.task_occurrences;
create trigger task_occurrences_bump_row_version
before update on app.task_occurrences
for each row execute function app.bump_row_version();

grant select, insert, update, delete on table app.task_occurrences to authenticated;

alter table app.task_occurrences enable row level security;

drop policy if exists task_occurrences_select_member on app.task_occurrences;
create policy task_occurrences_select_member
on app.task_occurrences
for select
to authenticated
using (
  exists (
    select 1
    from app.tasks task
    where task.id = task_occurrences.task_id
      and (select app.workspace_is_accessible(task.workspace_id))
  )
);

drop policy if exists task_occurrences_insert_member on app.task_occurrences;
create policy task_occurrences_insert_member
on app.task_occurrences
for insert
to authenticated
with check (
  exists (
    select 1
    from app.tasks task
    where task.id = task_occurrences.task_id
      and (select app.workspace_has_write_access(task.workspace_id))
  )
);

drop policy if exists task_occurrences_update_member on app.task_occurrences;
create policy task_occurrences_update_member
on app.task_occurrences
for update
to authenticated
using (
  exists (
    select 1
    from app.tasks task
    where task.id = task_occurrences.task_id
      and (select app.workspace_has_write_access(task.workspace_id))
  )
)
with check (
  exists (
    select 1
    from app.tasks task
    where task.id = task_occurrences.task_id
      and (select app.workspace_has_write_access(task.workspace_id))
  )
);

drop policy if exists task_occurrences_delete_member on app.task_occurrences;
create policy task_occurrences_delete_member
on app.task_occurrences
for delete
to authenticated
using (
  exists (
    select 1
    from app.tasks task
    where task.id = task_occurrences.task_id
      and (select app.workspace_has_write_access(task.workspace_id))
  )
);
