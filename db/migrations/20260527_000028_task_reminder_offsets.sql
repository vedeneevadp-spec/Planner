alter table app.task_reminders
  drop constraint if exists task_reminders_one_per_task;

alter table app.task_reminders
  add constraint task_reminders_one_per_task_offset
  unique (task_id, remind_offset_minutes);

drop function if exists app.sync_task_reminder(
  uuid,
  uuid,
  uuid,
  boolean,
  date,
  time,
  text,
  boolean
);

create or replace function app.sync_task_reminder(
  target_task_id uuid,
  target_workspace_id uuid,
  target_user_id uuid,
  reminder_enabled boolean,
  target_reminder_offsets integer[],
  target_planned_date date,
  target_planned_start_time time,
  target_time_zone text,
  target_is_active boolean
)
returns void
language plpgsql
as $$
declare
  next_offsets integer[];
  next_time_zone text;
  previous_time_zone text;
begin
  perform 1
  from app.task_reminders
  where task_id = target_task_id
  for update;

  select nullif(btrim(time_zone), '')
  into previous_time_zone
  from app.task_reminders
  where task_id = target_task_id
  order by updated_at desc
  limit 1;

  next_time_zone := nullif(btrim(coalesce(target_time_zone, '')), '');

  if next_time_zone is null then
    next_time_zone := previous_time_zone;
  end if;

  if next_time_zone is null then
    next_time_zone := 'UTC';
  end if;

  select coalesce(array_agg(distinct offset_minutes order by offset_minutes), '{}')
  into next_offsets
  from unnest(coalesce(target_reminder_offsets, '{}')) as offset_minutes
  where offset_minutes > 0 and offset_minutes <= 1440;

  if (
    not reminder_enabled
    or not target_is_active
    or target_planned_date is null
    or target_planned_start_time is null
    or cardinality(next_offsets) = 0
  ) then
    update app.task_reminders
    set
      canceled_at = now(),
      claimed_at = null
    where task_id = target_task_id
      and canceled_at is null;

    return;
  end if;

  update app.task_reminders
  set
    canceled_at = now(),
    claimed_at = null
  where task_id = target_task_id
    and not (remind_offset_minutes = any(next_offsets))
    and canceled_at is null;

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
  select
    target_workspace_id,
    target_task_id,
    target_user_id,
    target_planned_date,
    target_planned_start_time,
    offset_minutes,
    next_time_zone,
    null,
    null,
    null
  from unnest(next_offsets) as offset_minutes
  on conflict (task_id, remind_offset_minutes) do update
  set
    workspace_id = excluded.workspace_id,
    user_id = excluded.user_id,
    planned_date = excluded.planned_date,
    planned_start_time = excluded.planned_start_time,
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
