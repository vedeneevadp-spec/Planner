-- noinspection SqlNoDataSourceInspection
with target_orphans as (
  select
    occurrence.id,
    rule.id as target_schedule_rule_id,
    exists (
      select 1
      from app.self_care_completions completion
      where completion.occurrence_id = occurrence.id
    ) as has_completion,
    exists (
      select 1
      from app.self_care_appointment_details appointment
      where appointment.occurrence_id = occurrence.id
    ) as has_appointment,
    exists (
      select 1
      from app.self_care_occurrences linked
      where linked.item_id = occurrence.item_id
        and linked.schedule_rule_id = rule.id
        and linked.scheduled_for = occurrence.scheduled_for
    ) as has_linked_occurrence,
    row_number() over (
      partition by occurrence.item_id, rule.id, occurrence.scheduled_for
      order by
        case
          when exists (
            select 1
            from app.self_care_completions completion
            where completion.occurrence_id = occurrence.id
          ) then 0
          when exists (
            select 1
            from app.self_care_appointment_details appointment
            where appointment.occurrence_id = occurrence.id
          ) then 0
          else 1
        end,
        occurrence.updated_at desc,
        occurrence.created_at desc,
        occurrence.id desc
    ) as duplicate_rank
  from app.self_care_occurrences occurrence
  join app.self_care_schedule_rules rule on rule.item_id = occurrence.item_id
  join app.self_care_items item on item.id = occurrence.item_id
  where occurrence.schedule_rule_id is null
    and occurrence.completed_at is null
    and occurrence.status in ('scheduled', 'missed')
    and not rule.allow_multiple_per_day
    and item.deleted_at is null
)
delete from app.self_care_occurrences occurrence
using target_orphans target
where occurrence.id = target.id
  and (target.has_linked_occurrence or target.duplicate_rank > 1)
  and not target.has_completion
  and not target.has_appointment;

with target_orphans as (
  select
    occurrence.id,
    rule.id as target_schedule_rule_id,
    coalesce(occurrence.updated_by, item.updated_by, item.created_by) as next_updated_by,
    exists (
      select 1
      from app.self_care_occurrences linked
      where linked.item_id = occurrence.item_id
        and linked.schedule_rule_id = rule.id
        and linked.scheduled_for = occurrence.scheduled_for
    ) as has_linked_occurrence,
    row_number() over (
      partition by occurrence.item_id, rule.id, occurrence.scheduled_for
      order by occurrence.updated_at desc, occurrence.created_at desc, occurrence.id desc
    ) as duplicate_rank
  from app.self_care_occurrences occurrence
  join app.self_care_schedule_rules rule on rule.item_id = occurrence.item_id
  join app.self_care_items item on item.id = occurrence.item_id
  where occurrence.schedule_rule_id is null
    and occurrence.completed_at is null
    and occurrence.status in ('scheduled', 'missed')
    and not rule.allow_multiple_per_day
    and item.deleted_at is null
)
update app.self_care_occurrences occurrence
set
  schedule_rule_id = target.target_schedule_rule_id,
  updated_by = target.next_updated_by
from target_orphans target
where occurrence.id = target.id
  and not target.has_linked_occurrence
  and target.duplicate_rank = 1;
