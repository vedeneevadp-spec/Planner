-- Durable, disposable progress for the maintenance worker. This must not
-- update a user's schedule version just because a background scan ran.
create table app.self_care_reminder_generation (
  schedule_rule_id uuid primary key
    references app.self_care_schedule_rules(id) on delete cascade,
  checked_at timestamptz not null
);

create index self_care_reminder_generation_checked_idx
  on app.self_care_reminder_generation (checked_at, schedule_rule_id);

alter table app.self_care_reminder_generation enable row level security;
revoke all on app.self_care_reminder_generation from public, authenticated;

-- Keep the existing logical-backup role able to read the new internal table.
create policy planner_backup_select_all
  on app.self_care_reminder_generation for select to public
  using (session_user = 'planner_backup');

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'planner_backup') then
    grant select on app.self_care_reminder_generation to planner_backup;
  end if;
end;
$$;
