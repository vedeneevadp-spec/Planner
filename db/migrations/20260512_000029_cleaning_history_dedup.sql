-- noinspection SqlNoDataSourceInspection
with ranked_history as (
  select
    id,
    row_number() over (
      partition by workspace_id, task_id, action, date
      order by created_at desc, id desc
    ) as row_number
  from app.cleaning_task_history
)
delete from app.cleaning_task_history history
using ranked_history ranked
where history.id = ranked.id
  and ranked.row_number > 1;

create unique index if not exists cleaning_task_history_one_action_per_day_idx
  on app.cleaning_task_history (workspace_id, task_id, action, date);
