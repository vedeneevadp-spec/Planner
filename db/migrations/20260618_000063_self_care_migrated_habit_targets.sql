-- noinspection SqlNoDataSourceInspection
update app.self_care_schedule_rules as rule
set
  repeat_kind = 'flexible_goal'::app.self_care_repeat_kind,
  flexible_target_count = habit.target_value,
  flexible_period = 'day'::app.self_care_flexible_period,
  interval_value = null,
  interval_unit = null,
  day_of_month = null,
  week_of_month = null,
  month_of_year = null,
  updated_at = now()
from app.self_care_items as item
join app.habits as habit on habit.id = item.migrated_from_habit_id
where rule.item_id = item.id
  and item.migrated_from_habit_id is not null
  and habit.target_type in ('check', 'count')
  and habit.target_value > 1
  and (
    rule.repeat_kind <> 'flexible_goal'
    or rule.flexible_target_count is distinct from habit.target_value
    or rule.flexible_period is distinct from 'day'::app.self_care_flexible_period
  );
