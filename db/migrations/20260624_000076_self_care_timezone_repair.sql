-- noinspection SqlNoDataSourceInspection

with repair_candidates as (
  select
    occurrence.id,
    occurrence.due_at as old_due_at,
    occurrence.scheduled_for,
    coalesce(
      nullif(actor.default_time_zone, ''),
      nullif(workspace.default_time_zone, ''),
      'Europe/Astrakhan',
      'UTC'
    ) as resolved_time_zone
  from app.self_care_occurrences occurrence
  join app.self_care_items item
    on item.id = occurrence.item_id
  left join app.users actor
    on actor.id = occurrence.user_id
  left join app.workspaces workspace
    on workspace.id = item.workspace_id
  where occurrence.due_at is not null
    and occurrence.reminder_time_zone is null
),
repaired_occurrences as (
  update app.self_care_occurrences occurrence
  set
    due_at = make_timestamptz(
      extract(year from repair.scheduled_for)::int,
      extract(month from repair.scheduled_for)::int,
      extract(day from repair.scheduled_for)::int,
      extract(hour from (repair.old_due_at at time zone 'UTC')::time)::int,
      extract(minute from (repair.old_due_at at time zone 'UTC')::time)::int,
      0,
      repair.resolved_time_zone
    ),
    reminder_time_zone = repair.resolved_time_zone,
    updated_at = now()
  from repair_candidates repair
  where occurrence.id = repair.id
  returning
    occurrence.id,
    repair.old_due_at,
    occurrence.due_at,
    repair.resolved_time_zone
)
update app.self_care_appointment_details details
set
  starts_at = make_timestamptz(
    extract(year from (details.starts_at at time zone 'UTC')::date)::int,
    extract(month from (details.starts_at at time zone 'UTC')::date)::int,
    extract(day from (details.starts_at at time zone 'UTC')::date)::int,
    extract(hour from (details.starts_at at time zone 'UTC')::time)::int,
    extract(minute from (details.starts_at at time zone 'UTC')::time)::int,
    0,
    repaired.resolved_time_zone
  ),
  ends_at = case
    when details.ends_at is null then null
    else make_timestamptz(
      extract(year from (details.ends_at at time zone 'UTC')::date)::int,
      extract(month from (details.ends_at at time zone 'UTC')::date)::int,
      extract(day from (details.ends_at at time zone 'UTC')::date)::int,
      extract(hour from (details.ends_at at time zone 'UTC')::time)::int,
      extract(minute from (details.ends_at at time zone 'UTC')::time)::int,
      0,
      repaired.resolved_time_zone
    )
  end,
  updated_at = now()
from repaired_occurrences repaired
where details.occurrence_id = repaired.id
  and details.starts_at = repaired.old_due_at;
