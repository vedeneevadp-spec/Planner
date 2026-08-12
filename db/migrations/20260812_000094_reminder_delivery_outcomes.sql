-- Keep delivery outcomes truthful and observable. Expired and permanently
-- failed reminders must never be recorded as successfully sent.

alter table app.task_reminders
  add column if not exists expired_at timestamptz,
  add column if not exists failed_at timestamptz,
  add column if not exists attempt_count integer not null default 0,
  add column if not exists last_error text;

alter table app.self_care_reminders
  add column if not exists expired_at timestamptz,
  add column if not exists failed_at timestamptz,
  add column if not exists attempt_count integer not null default 0,
  add column if not exists last_error text;

alter table app.task_reminders
  drop constraint if exists task_reminders_attempt_count_check,
  add constraint task_reminders_attempt_count_check check (attempt_count >= 0);

alter table app.self_care_reminders
  drop constraint if exists self_care_reminders_attempt_count_check,
  add constraint self_care_reminders_attempt_count_check check (attempt_count >= 0);

create or replace function app.reset_task_reminder_delivery_state()
returns trigger
language plpgsql
as $$
begin
  if row(new.planned_date, new.planned_start_time, new.time_zone)
      is distinct from
     row(old.planned_date, old.planned_start_time, old.time_zone)
    or (old.canceled_at is not null and new.canceled_at is null)
  then
    new.claimed_at := null;
    new.sent_at := null;
    new.expired_at := null;
    new.failed_at := null;
    new.attempt_count := 0;
    new.last_error := null;
  end if;

  return new;
end;
$$;

drop trigger if exists task_reminders_reset_delivery_state on app.task_reminders;
create trigger task_reminders_reset_delivery_state
before update on app.task_reminders
for each row execute function app.reset_task_reminder_delivery_state();

drop index if exists app.task_reminders_pending_idx;
create index task_reminders_pending_idx
  on app.task_reminders (
    sent_at,
    expired_at,
    failed_at,
    canceled_at,
    claimed_at,
    planned_date,
    planned_start_time
  );

drop index if exists app.self_care_reminders_pending_idx;
create index self_care_reminders_pending_idx
  on app.self_care_reminders (
    sent_at,
    expired_at,
    failed_at,
    canceled_at,
    claimed_at,
    reminder_at,
    due_at
  );
