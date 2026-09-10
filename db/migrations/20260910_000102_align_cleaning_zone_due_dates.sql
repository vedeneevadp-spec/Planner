-- noinspection SqlNoDataSourceInspection

-- Before this release, completion and skip actions advanced a zone task by its
-- interval but did not return the resulting date to the zone weekday. Repair
-- only states whose latest action generated the recurrence; explicit postpone
-- dates remain exactly where the user placed them.
with latest_task_action as (
  select distinct on (history.task_id)
    history.action,
    history.task_id
  from app.cleaning_task_history as history
  order by history.task_id, history.created_at desc, history.id desc
)
update app.cleaning_task_states as state
set next_due_at = state.next_due_at + (
  (
    zone.day_of_week
    - extract(isodow from state.next_due_at)::integer
    + 7
  ) % 7
)
from app.cleaning_tasks as task
inner join app.cleaning_zones as zone
  on zone.id = task.zone_id
inner join latest_task_action as latest_action
  on latest_action.task_id = task.id
where task.id = state.task_id
  and task.scope = 'zone'
  and task.is_seasonal = false
  and state.next_due_at is not null
  and latest_action.action in ('completed', 'skipped')
  and extract(isodow from state.next_due_at)::integer <> zone.day_of_week;
