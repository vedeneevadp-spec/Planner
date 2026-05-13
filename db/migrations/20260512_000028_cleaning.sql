-- noinspection SqlNoDataSourceInspection
do $$
begin
  if not exists (
    select 1 from pg_type where typnamespace = 'app'::regnamespace and typname = 'cleaning_priority'
  ) then
    create type app.cleaning_priority as enum ('low', 'normal', 'high');
  end if;

  if not exists (
    select 1 from pg_type where typnamespace = 'app'::regnamespace and typname = 'cleaning_frequency_type'
  ) then
    create type app.cleaning_frequency_type as enum ('weekly', 'monthly', 'custom');
  end if;

  if not exists (
    select 1 from pg_type where typnamespace = 'app'::regnamespace and typname = 'cleaning_depth'
  ) then
    create type app.cleaning_depth as enum ('minimum', 'regular', 'deep');
  end if;

  if not exists (
    select 1 from pg_type where typnamespace = 'app'::regnamespace and typname = 'cleaning_energy'
  ) then
    create type app.cleaning_energy as enum ('low', 'normal', 'high');
  end if;

  if not exists (
    select 1 from pg_type where typnamespace = 'app'::regnamespace and typname = 'cleaning_assignee'
  ) then
    create type app.cleaning_assignee as enum ('self', 'partner', 'child', 'anyone');
  end if;

  if not exists (
    select 1 from pg_type where typnamespace = 'app'::regnamespace and typname = 'cleaning_task_history_action'
  ) then
    create type app.cleaning_task_history_action as enum ('completed', 'postponed', 'skipped');
  end if;
end $$;

create table if not exists app.cleaning_zones (
  id uuid primary key default app.uuid_generate_v7(),
  workspace_id uuid not null references app.workspaces(id) on delete cascade,
  user_id uuid not null references app.users(id) on delete cascade,
  title text not null,
  description text not null default '',
  day_of_week smallint not null,
  is_active boolean not null default true,
  sort_order integer not null default 0,
  created_by uuid references app.users(id),
  updated_by uuid references app.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  version bigint not null default 1,
  constraint cleaning_zones_title_not_blank check (length(btrim(title)) > 0),
  constraint cleaning_zones_day_of_week_valid check (day_of_week between 1 and 7)
);

create table if not exists app.cleaning_tasks (
  id uuid primary key default app.uuid_generate_v7(),
  workspace_id uuid not null references app.workspaces(id) on delete cascade,
  zone_id uuid not null references app.cleaning_zones(id) on delete cascade,
  user_id uuid not null references app.users(id) on delete cascade,
  title text not null,
  description text not null default '',
  priority app.cleaning_priority not null default 'normal',
  estimated_minutes integer,
  frequency_type app.cleaning_frequency_type not null default 'weekly',
  frequency_interval integer not null default 1,
  custom_interval_days integer,
  depth app.cleaning_depth not null default 'regular',
  energy app.cleaning_energy not null default 'normal',
  assignee app.cleaning_assignee not null default 'anyone',
  impact_score integer not null default 3,
  is_seasonal boolean not null default false,
  season_months smallint[] not null default array[]::smallint[],
  tags text[] not null default array[]::text[],
  is_active boolean not null default true,
  sort_order integer not null default 0,
  created_by uuid references app.users(id),
  updated_by uuid references app.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  version bigint not null default 1,
  constraint cleaning_tasks_title_not_blank check (length(btrim(title)) > 0),
  constraint cleaning_tasks_estimated_minutes_positive check (
    estimated_minutes is null or estimated_minutes > 0
  ),
  constraint cleaning_tasks_frequency_interval_positive check (frequency_interval > 0),
  constraint cleaning_tasks_custom_interval_positive check (
    custom_interval_days is null or custom_interval_days > 0
  ),
  constraint cleaning_tasks_impact_score_range check (impact_score between 1 and 5),
  constraint cleaning_tasks_season_months_valid check (
    season_months <@ array[1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]::smallint[]
  )
);

create table if not exists app.cleaning_task_states (
  task_id uuid primary key references app.cleaning_tasks(id) on delete cascade,
  workspace_id uuid not null references app.workspaces(id) on delete cascade,
  user_id uuid not null references app.users(id) on delete cascade,
  last_completed_at timestamptz,
  next_due_at date,
  postpone_count integer not null default 0,
  last_postponed_at timestamptz,
  last_skipped_at timestamptz,
  created_by uuid references app.users(id),
  updated_by uuid references app.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  version bigint not null default 1,
  constraint cleaning_task_states_postpone_count_nonnegative check (postpone_count >= 0)
);

create table if not exists app.cleaning_task_history (
  id uuid primary key default app.uuid_generate_v7(),
  workspace_id uuid not null references app.workspaces(id) on delete cascade,
  task_id uuid not null references app.cleaning_tasks(id) on delete cascade,
  zone_id uuid not null references app.cleaning_zones(id) on delete cascade,
  user_id uuid not null references app.users(id) on delete cascade,
  action app.cleaning_task_history_action not null,
  date date not null,
  target_date date,
  note text not null default '',
  created_by uuid references app.users(id),
  created_at timestamptz not null default now()
);

create index if not exists cleaning_zones_workspace_active_idx
  on app.cleaning_zones (workspace_id, is_active, day_of_week, sort_order, title)
  where deleted_at is null;

create index if not exists cleaning_tasks_workspace_zone_idx
  on app.cleaning_tasks (workspace_id, zone_id, is_active, sort_order, title)
  where deleted_at is null;

create index if not exists cleaning_task_states_workspace_due_idx
  on app.cleaning_task_states (workspace_id, next_due_at, postpone_count);

create index if not exists cleaning_task_history_workspace_date_idx
  on app.cleaning_task_history (workspace_id, date desc, created_at desc);

drop trigger if exists cleaning_zones_bump_row_version on app.cleaning_zones;
create trigger cleaning_zones_bump_row_version
before update on app.cleaning_zones
for each row execute function app.bump_row_version();

drop trigger if exists cleaning_tasks_bump_row_version on app.cleaning_tasks;
create trigger cleaning_tasks_bump_row_version
before update on app.cleaning_tasks
for each row execute function app.bump_row_version();

drop trigger if exists cleaning_task_states_bump_row_version on app.cleaning_task_states;
create trigger cleaning_task_states_bump_row_version
before update on app.cleaning_task_states
for each row execute function app.bump_row_version();

grant select, insert, update, delete on table app.cleaning_zones to authenticated;
grant select, insert, update, delete on table app.cleaning_tasks to authenticated;
grant select, insert, update, delete on table app.cleaning_task_states to authenticated;
grant select, insert on table app.cleaning_task_history to authenticated;

alter table app.cleaning_zones enable row level security;
alter table app.cleaning_tasks enable row level security;
alter table app.cleaning_task_states enable row level security;
alter table app.cleaning_task_history enable row level security;

drop policy if exists cleaning_zones_select_member on app.cleaning_zones;
create policy cleaning_zones_select_member
on app.cleaning_zones
for select
to authenticated
using (
  (select app.workspace_is_accessible(workspace_id))
  and deleted_at is null
);

drop policy if exists cleaning_zones_insert_member on app.cleaning_zones;
create policy cleaning_zones_insert_member
on app.cleaning_zones
for insert
to authenticated
with check (
  (select app.workspace_has_write_access(workspace_id))
  and user_id = (select app.current_user_id())
  and created_by = (select app.current_user_id())
  and updated_by = (select app.current_user_id())
);

drop policy if exists cleaning_zones_update_member on app.cleaning_zones;
create policy cleaning_zones_update_member
on app.cleaning_zones
for update
to authenticated
using ((select app.workspace_has_write_access(workspace_id)))
with check (
  (select app.workspace_has_write_access(workspace_id))
  and updated_by = (select app.current_user_id())
);

drop policy if exists cleaning_zones_delete_member on app.cleaning_zones;
create policy cleaning_zones_delete_member
on app.cleaning_zones
for delete
to authenticated
using ((select app.workspace_has_write_access(workspace_id)));

drop policy if exists cleaning_tasks_select_member on app.cleaning_tasks;
create policy cleaning_tasks_select_member
on app.cleaning_tasks
for select
to authenticated
using (
  (select app.workspace_is_accessible(workspace_id))
  and deleted_at is null
);

drop policy if exists cleaning_tasks_insert_member on app.cleaning_tasks;
create policy cleaning_tasks_insert_member
on app.cleaning_tasks
for insert
to authenticated
with check (
  (select app.workspace_has_write_access(workspace_id))
  and user_id = (select app.current_user_id())
  and created_by = (select app.current_user_id())
  and updated_by = (select app.current_user_id())
);

drop policy if exists cleaning_tasks_update_member on app.cleaning_tasks;
create policy cleaning_tasks_update_member
on app.cleaning_tasks
for update
to authenticated
using ((select app.workspace_has_write_access(workspace_id)))
with check (
  (select app.workspace_has_write_access(workspace_id))
  and updated_by = (select app.current_user_id())
);

drop policy if exists cleaning_tasks_delete_member on app.cleaning_tasks;
create policy cleaning_tasks_delete_member
on app.cleaning_tasks
for delete
to authenticated
using ((select app.workspace_has_write_access(workspace_id)));

drop policy if exists cleaning_task_states_select_member on app.cleaning_task_states;
create policy cleaning_task_states_select_member
on app.cleaning_task_states
for select
to authenticated
using ((select app.workspace_is_accessible(workspace_id)));

drop policy if exists cleaning_task_states_insert_member on app.cleaning_task_states;
create policy cleaning_task_states_insert_member
on app.cleaning_task_states
for insert
to authenticated
with check (
  (select app.workspace_has_write_access(workspace_id))
  and user_id = (select app.current_user_id())
  and created_by = (select app.current_user_id())
  and updated_by = (select app.current_user_id())
);

drop policy if exists cleaning_task_states_update_member on app.cleaning_task_states;
create policy cleaning_task_states_update_member
on app.cleaning_task_states
for update
to authenticated
using ((select app.workspace_has_write_access(workspace_id)))
with check (
  (select app.workspace_has_write_access(workspace_id))
  and updated_by = (select app.current_user_id())
);

drop policy if exists cleaning_task_states_delete_member on app.cleaning_task_states;
create policy cleaning_task_states_delete_member
on app.cleaning_task_states
for delete
to authenticated
using ((select app.workspace_has_write_access(workspace_id)));

drop policy if exists cleaning_task_history_select_member on app.cleaning_task_history;
create policy cleaning_task_history_select_member
on app.cleaning_task_history
for select
to authenticated
using ((select app.workspace_is_accessible(workspace_id)));

drop policy if exists cleaning_task_history_insert_member on app.cleaning_task_history;
create policy cleaning_task_history_insert_member
on app.cleaning_task_history
for insert
to authenticated
with check (
  (select app.workspace_has_write_access(workspace_id))
  and user_id = (select app.current_user_id())
  and created_by = (select app.current_user_id())
);
