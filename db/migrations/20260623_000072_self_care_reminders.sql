alter table app.self_care_occurrences
  add column if not exists reminder_offsets_minutes integer[] not null default array[]::integer[],
  add column if not exists reminder_time_zone text;

alter table app.self_care_occurrences
  drop constraint if exists self_care_occurrences_reminder_offsets_valid;

alter table app.self_care_occurrences
  add constraint self_care_occurrences_reminder_offsets_valid check (
    reminder_offsets_minutes <@ array[
      0,
      15,
      30,
      60,
      120,
      180,
      360,
      720,
      1440,
      2880,
      10080,
      43200
    ]::integer[]
  );

alter table app.self_care_schedule_rules
  drop constraint if exists self_care_schedule_reminder_offsets_valid;

alter table app.self_care_schedule_rules
  add constraint self_care_schedule_reminder_offsets_valid check (
    reminder_offsets_minutes <@ array[
      0,
      15,
      30,
      60,
      120,
      180,
      360,
      720,
      1440,
      2880,
      10080,
      43200
    ]::integer[]
  );

create table if not exists app.self_care_reminders (
  id uuid primary key default app.uuid_generate_v7(),
  workspace_id uuid not null references app.workspaces(id) on delete cascade,
  user_id uuid not null references app.users(id) on delete cascade,
  item_id uuid not null references app.self_care_items(id) on delete cascade,
  occurrence_id uuid not null references app.self_care_occurrences(id) on delete cascade,
  schedule_rule_id uuid references app.self_care_schedule_rules(id) on delete set null,
  remind_offset_minutes integer not null,
  due_at timestamptz not null,
  reminder_at timestamptz not null,
  time_zone text not null,
  claimed_at timestamptz,
  sent_at timestamptz,
  canceled_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  version bigint not null default 1,
  constraint self_care_reminders_one_per_occurrence_offset unique (occurrence_id, remind_offset_minutes),
  constraint self_care_reminders_offset_check check (
    remind_offset_minutes >= 0 and remind_offset_minutes <= 43200
  )
);

create index if not exists self_care_reminders_pending_idx
  on app.self_care_reminders (
    sent_at,
    canceled_at,
    claimed_at,
    reminder_at,
    due_at
  );

create index if not exists self_care_reminders_user_workspace_idx
  on app.self_care_reminders (user_id, workspace_id, reminder_at desc);

drop trigger if exists self_care_reminders_bump_row_version on app.self_care_reminders;
create trigger self_care_reminders_bump_row_version
before update on app.self_care_reminders
for each row execute function app.bump_row_version();

grant select, insert, update, delete on table app.self_care_reminders to authenticated;

alter table app.self_care_reminders enable row level security;

drop policy if exists self_care_reminders_select_self on app.self_care_reminders;
create policy self_care_reminders_select_self
on app.self_care_reminders
for select
to authenticated
using (
  user_id = (select app.current_user_id())
  and (select app.workspace_is_accessible(workspace_id))
);

drop policy if exists self_care_reminders_insert_self on app.self_care_reminders;
create policy self_care_reminders_insert_self
on app.self_care_reminders
for insert
to authenticated
with check (
  user_id = (select app.current_user_id())
  and (select app.workspace_is_accessible(workspace_id))
);

drop policy if exists self_care_reminders_update_self on app.self_care_reminders;
create policy self_care_reminders_update_self
on app.self_care_reminders
for update
to authenticated
using (
  user_id = (select app.current_user_id())
)
with check (
  user_id = (select app.current_user_id())
  and (select app.workspace_is_accessible(workspace_id))
);

drop policy if exists self_care_reminders_delete_self on app.self_care_reminders;
create policy self_care_reminders_delete_self
on app.self_care_reminders
for delete
to authenticated
using (
  user_id = (select app.current_user_id())
  and (select app.workspace_has_write_access(workspace_id))
);
