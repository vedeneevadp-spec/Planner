-- Keep removed ritual steps available to their historical completions.
alter table app.self_care_ritual_steps
  add column deleted_at timestamptz;
alter table app.self_care_ritual_step_completions
  add column step_title text,
  add column step_order integer;

update app.self_care_ritual_step_completions completion
set step_title = step.title, step_order = step.sort_order
from app.self_care_ritual_steps step
where step.id = completion.step_id;

-- Also supports old backup rows and callers that omit the additive snapshot.
create function app.snapshot_self_care_ritual_step()
returns trigger
language plpgsql
set search_path = app, pg_temp
as $$
begin
  select coalesce(new.step_title, step.title), coalesce(new.step_order, step.sort_order)
    into new.step_title, new.step_order
  from self_care_ritual_steps step
  where step.id = new.step_id;
  return new;
end;
$$;

create trigger self_care_ritual_step_completion_snapshot
before insert on app.self_care_ritual_step_completions
for each row execute function app.snapshot_self_care_ritual_step();

revoke all on function app.snapshot_self_care_ritual_step() from public;

-- Manual scheduling has always stored a resolved timezone; generated rows did
-- not. Preserve those existing exceptions when future rules are reconciled.
-- New manual scheduling explicitly leaves generated_at null.
update app.self_care_occurrences occurrence
set generated_at = null
where generated_at is not null
  and (
    schedule_rule_id is null
    or reminder_time_zone is not null
    or cardinality(reminder_offsets_minutes) > 0
    or exists (
      select 1 from app.self_care_appointment_details details
      where details.occurrence_id = occurrence.id
    )
  );

comment on column app.self_care_occurrences.generated_at is
  'Non-null only for automatically generated schedule slots; null preserves a manual schedule or override.';
