-- noinspection SqlNoDataSourceInspection
do $$
begin
  if not exists (
    select 1 from pg_type where typnamespace = 'app'::regnamespace and typname = 'habit_frequency'
  ) then
    create type app.habit_frequency as enum ('daily', 'weekly', 'custom');
  end if;

  if not exists (
    select 1 from pg_type where typnamespace = 'app'::regnamespace and typname = 'habit_target_type'
  ) then
    create type app.habit_target_type as enum ('check', 'count', 'duration');
  end if;

  if not exists (
    select 1 from pg_type where typnamespace = 'app'::regnamespace and typname = 'habit_entry_status'
  ) then
    create type app.habit_entry_status as enum ('done', 'skipped');
  end if;
end $$;

create table if not exists app.habits (
  id uuid primary key default app.uuid_generate_v7(),
  workspace_id uuid not null references app.workspaces(id) on delete cascade,
  user_id uuid not null references app.users(id) on delete cascade,
  sphere_id uuid references app.projects(id) on delete set null,
  title text not null,
  description text not null default '',
  icon text not null default 'check',
  color text not null default '#2f6f62',
  frequency app.habit_frequency not null default 'daily',
  days_of_week smallint[] not null default array[1, 2, 3, 4, 5, 6, 7]::smallint[],
  target_type app.habit_target_type not null default 'check',
  target_value integer not null default 1,
  unit text not null default '',
  reminder_time time,
  start_date date not null default current_date,
  end_date date,
  is_active boolean not null default true,
  sort_order integer not null default 0,
  created_by uuid references app.users(id),
  updated_by uuid references app.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  version bigint not null default 1,
  constraint habits_title_not_blank check (length(btrim(title)) > 0),
  constraint habits_days_of_week_not_empty check (cardinality(days_of_week) between 1 and 7),
  constraint habits_days_of_week_valid check (
    days_of_week <@ array[1, 2, 3, 4, 5, 6, 7]::smallint[]
  ),
  constraint habits_target_value_positive check (target_value > 0),
  constraint habits_date_range_valid check (end_date is null or end_date >= start_date)
);

create table if not exists app.habit_entries (
  id uuid primary key default app.uuid_generate_v7(),
  workspace_id uuid not null references app.workspaces(id) on delete cascade,
  habit_id uuid not null references app.habits(id) on delete cascade,
  user_id uuid not null references app.users(id) on delete cascade,
  date date not null,
  status app.habit_entry_status not null default 'done',
  value integer not null default 1,
  note text not null default '',
  created_by uuid references app.users(id),
  updated_by uuid references app.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  version bigint not null default 1,
  constraint habit_entries_value_nonnegative check (value >= 0)
);

create index if not exists habits_workspace_active_idx
  on app.habits (workspace_id, is_active, sort_order, title)
  where deleted_at is null;

create index if not exists habits_workspace_sphere_idx
  on app.habits (workspace_id, sphere_id)
  where sphere_id is not null and deleted_at is null;

create index if not exists habit_entries_workspace_date_idx
  on app.habit_entries (workspace_id, date, habit_id)
  where deleted_at is null;

create unique index if not exists habit_entries_one_active_per_day_idx
  on app.habit_entries (workspace_id, habit_id, date)
  where deleted_at is null;

drop trigger if exists habits_bump_row_version on app.habits;
create trigger habits_bump_row_version
before update on app.habits
for each row execute function app.bump_row_version();

drop trigger if exists habit_entries_bump_row_version on app.habit_entries;
create trigger habit_entries_bump_row_version
before update on app.habit_entries
for each row execute function app.bump_row_version();

grant select, insert, update, delete on table app.habits to authenticated;
grant select, insert, update, delete on table app.habit_entries to authenticated;

alter table app.habits enable row level security;
alter table app.habit_entries enable row level security;

drop policy if exists habits_select_member on app.habits;
create policy habits_select_member
on app.habits
for select
to authenticated
using (
  (select app.workspace_is_accessible(workspace_id))
  and deleted_at is null
);

drop policy if exists habits_insert_member on app.habits;
create policy habits_insert_member
on app.habits
for insert
to authenticated
with check (
  (select app.workspace_has_write_access(workspace_id))
  and user_id = (select app.current_user_id())
  and created_by = (select app.current_user_id())
  and updated_by = (select app.current_user_id())
);

drop policy if exists habits_update_member on app.habits;
create policy habits_update_member
on app.habits
for update
to authenticated
using (
  (select app.workspace_has_write_access(workspace_id))
)
with check (
  (select app.workspace_has_write_access(workspace_id))
  and updated_by = (select app.current_user_id())
);

drop policy if exists habits_delete_member on app.habits;
create policy habits_delete_member
on app.habits
for delete
to authenticated
using (
  (select app.workspace_has_write_access(workspace_id))
);

drop policy if exists habit_entries_select_member on app.habit_entries;
create policy habit_entries_select_member
on app.habit_entries
for select
to authenticated
using (
  (select app.workspace_is_accessible(workspace_id))
  and deleted_at is null
);

drop policy if exists habit_entries_insert_member on app.habit_entries;
create policy habit_entries_insert_member
on app.habit_entries
for insert
to authenticated
with check (
  (select app.workspace_has_write_access(workspace_id))
  and user_id = (select app.current_user_id())
  and created_by = (select app.current_user_id())
  and updated_by = (select app.current_user_id())
);

drop policy if exists habit_entries_update_member on app.habit_entries;
create policy habit_entries_update_member
on app.habit_entries
for update
to authenticated
using (
  (select app.workspace_has_write_access(workspace_id))
)
with check (
  (select app.workspace_has_write_access(workspace_id))
  and updated_by = (select app.current_user_id())
);

drop policy if exists habit_entries_delete_member on app.habit_entries;
create policy habit_entries_delete_member
on app.habit_entries
for delete
to authenticated
using (
  (select app.workspace_has_write_access(workspace_id))
);
