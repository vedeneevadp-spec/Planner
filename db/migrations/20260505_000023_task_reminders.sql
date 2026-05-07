create table if not exists app.task_reminders (
  id uuid primary key default app.uuid_generate_v7(),
  workspace_id uuid not null references app.workspaces(id) on delete cascade,
  task_id uuid not null references app.tasks(id) on delete cascade,
  user_id uuid not null references app.users(id) on delete cascade,
  planned_date date not null,
  planned_start_time time not null,
  remind_offset_minutes integer not null default 15,
  time_zone text not null,
  claimed_at timestamptz,
  sent_at timestamptz,
  canceled_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  version bigint not null default 1,
  constraint task_reminders_one_per_task unique (task_id),
  constraint task_reminders_offset_check check (
    remind_offset_minutes >= 0 and remind_offset_minutes <= 1440
  )
);

create index if not exists task_reminders_pending_idx
  on app.task_reminders (
    sent_at,
    canceled_at,
    claimed_at,
    planned_date,
    planned_start_time
  );

create index if not exists task_reminders_user_workspace_idx
  on app.task_reminders (user_id, workspace_id, created_at desc);

drop trigger if exists task_reminders_bump_row_version on app.task_reminders;
create trigger task_reminders_bump_row_version
before update on app.task_reminders
for each row execute function app.bump_row_version();

grant select, insert, update, delete on table app.task_reminders to authenticated;

alter table app.task_reminders enable row level security;

drop policy if exists task_reminders_select_self on app.task_reminders;
create policy task_reminders_select_self
on app.task_reminders
for select
to authenticated
using (
  user_id = (select app.current_user_id())
  and (select app.workspace_is_accessible(workspace_id))
);

drop policy if exists task_reminders_insert_self on app.task_reminders;
create policy task_reminders_insert_self
on app.task_reminders
for insert
to authenticated
with check (
  user_id = (select app.current_user_id())
  and (select app.workspace_is_accessible(workspace_id))
);

drop policy if exists task_reminders_update_self on app.task_reminders;
create policy task_reminders_update_self
on app.task_reminders
for update
to authenticated
using (
  user_id = (select app.current_user_id())
)
with check (
  user_id = (select app.current_user_id())
  and (select app.workspace_is_accessible(workspace_id))
);

drop policy if exists task_reminders_delete_self on app.task_reminders;
create policy task_reminders_delete_self
on app.task_reminders
for delete
to authenticated
using (
  user_id = (select app.current_user_id())
  and (select app.workspace_has_write_access(workspace_id))
);

create or replace function app.sync_task_reminder(
  target_task_id uuid,
  target_workspace_id uuid,
  target_user_id uuid,
  reminder_enabled boolean,
  target_planned_date date,
  target_planned_start_time time,
  target_time_zone text,
  target_is_active boolean
)
returns void
language plpgsql
as $$
declare
  existing_record app.task_reminders%rowtype;
  next_time_zone text;
begin
  select *
  into existing_record
  from app.task_reminders
  where task_id = target_task_id
  for update;

  next_time_zone := nullif(btrim(coalesce(target_time_zone, '')), '');

  if next_time_zone is null then
    next_time_zone := nullif(btrim(coalesce(existing_record.time_zone, '')), '');
  end if;

  if next_time_zone is null then
    next_time_zone := 'UTC';
  end if;

  if (
    not reminder_enabled
    or not target_is_active
    or target_planned_date is null
    or target_planned_start_time is null
  ) then
    if existing_record.id is not null then
      update app.task_reminders
      set
        canceled_at = now(),
        claimed_at = null
      where id = existing_record.id;
    end if;

    return;
  end if;

  insert into app.task_reminders (
    workspace_id,
    task_id,
    user_id,
    planned_date,
    planned_start_time,
    remind_offset_minutes,
    time_zone,
    claimed_at,
    sent_at,
    canceled_at
  )
  values (
    target_workspace_id,
    target_task_id,
    target_user_id,
    target_planned_date,
    target_planned_start_time,
    15,
    next_time_zone,
    null,
    null,
    null
  )
  on conflict (task_id) do update
  set
    workspace_id = excluded.workspace_id,
    user_id = excluded.user_id,
    planned_date = excluded.planned_date,
    planned_start_time = excluded.planned_start_time,
    remind_offset_minutes = excluded.remind_offset_minutes,
    time_zone = excluded.time_zone,
    claimed_at = null,
    canceled_at = null,
    sent_at = case
      when app.task_reminders.planned_date = excluded.planned_date
        and app.task_reminders.planned_start_time = excluded.planned_start_time
        and app.task_reminders.time_zone = excluded.time_zone
      then app.task_reminders.sent_at
      else null
    end;
end;
$$;
