-- noinspection SqlNoDataSourceInspection
do $$
begin
  if not exists (select 1 from pg_type where typnamespace = 'app'::regnamespace and typname = 'self_care_item_type') then
    create type app.self_care_item_type as enum ('task', 'habit', 'ritual', 'procedure', 'appointment', 'medical', 'flexible_goal', 'course', 'mood_check', 'measurement', 'rest_action');
  end if;

  if not exists (select 1 from pg_type where typnamespace = 'app'::regnamespace and typname = 'self_care_category') then
    create type app.self_care_category as enum ('health', 'beauty', 'body', 'movement', 'relax', 'daily_base', 'emotional', 'sleep', 'nutrition', 'medical', 'custom');
  end if;

  if not exists (select 1 from pg_type where typnamespace = 'app'::regnamespace and typname = 'self_care_importance') then
    create type app.self_care_importance as enum ('required', 'recommended', 'gentle');
  end if;

  if not exists (select 1 from pg_type where typnamespace = 'app'::regnamespace and typname = 'self_care_time_of_day') then
    create type app.self_care_time_of_day as enum ('morning', 'afternoon', 'evening', 'night', 'anytime');
  end if;

  if not exists (select 1 from pg_type where typnamespace = 'app'::regnamespace and typname = 'self_care_repeat_kind') then
    create type app.self_care_repeat_kind as enum ('none', 'daily', 'weekly', 'monthly', 'yearly', 'interval', 'after_completion', 'flexible_goal', 'course');
  end if;

  if not exists (select 1 from pg_type where typnamespace = 'app'::regnamespace and typname = 'self_care_interval_unit') then
    create type app.self_care_interval_unit as enum ('day', 'week', 'month', 'year');
  end if;

  if not exists (select 1 from pg_type where typnamespace = 'app'::regnamespace and typname = 'self_care_flexible_period') then
    create type app.self_care_flexible_period as enum ('day', 'week', 'month');
  end if;

  if not exists (select 1 from pg_type where typnamespace = 'app'::regnamespace and typname = 'self_care_occurrence_status') then
    create type app.self_care_occurrence_status as enum ('scheduled', 'done', 'partial', 'skipped', 'moved', 'cancelled', 'missed');
  end if;

  if not exists (select 1 from pg_type where typnamespace = 'app'::regnamespace and typname = 'self_care_completion_status') then
    create type app.self_care_completion_status as enum ('done', 'partial', 'skipped', 'moved', 'cancelled', 'alternative_done');
  end if;

  if not exists (select 1 from pg_type where typnamespace = 'app'::regnamespace and typname = 'self_care_completed_variant') then
    create type app.self_care_completed_variant as enum ('full', 'minimum', 'alternative');
  end if;

  if not exists (select 1 from pg_type where typnamespace = 'app'::regnamespace and typname = 'self_care_course_type') then
    create type app.self_care_course_type as enum ('sessions', 'days');
  end if;

  if not exists (select 1 from pg_type where typnamespace = 'app'::regnamespace and typname = 'self_care_reminder_tone') then
    create type app.self_care_reminder_tone as enum ('soft', 'normal');
  end if;

  if not exists (select 1 from pg_type where typnamespace = 'app'::regnamespace and typname = 'self_care_reminder_strategy') then
    create type app.self_care_reminder_strategy as enum ('soft', 'normal', 'persistent');
  end if;
end $$;

create table if not exists app.self_care_items (
  id uuid primary key default app.uuid_generate_v7(),
  workspace_id uuid not null references app.workspaces(id) on delete cascade,
  user_id uuid not null references app.users(id) on delete cascade,
  title text not null,
  description text not null default '',
  type app.self_care_item_type not null,
  category app.self_care_category not null,
  custom_category_id uuid,
  importance app.self_care_importance not null default 'recommended',
  icon text,
  color text,
  is_active boolean not null default true,
  is_archived boolean not null default false,
  is_private boolean not null default true,
  preferred_time_of_day app.self_care_time_of_day,
  default_duration_minutes integer,
  minimum_version_title text,
  minimum_version_description text,
  minimum_version_duration_minutes integer,
  created_from_template_id text,
  migrated_from_habit_id uuid,
  created_by uuid references app.users(id),
  updated_by uuid references app.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  version bigint not null default 1,
  constraint self_care_items_title_not_blank check (length(btrim(title)) > 0),
  constraint self_care_items_default_duration_positive check (default_duration_minutes is null or default_duration_minutes > 0),
  constraint self_care_items_minimum_duration_positive check (minimum_version_duration_minutes is null or minimum_version_duration_minutes > 0)
);

create table if not exists app.self_care_item_alternatives (
  id uuid primary key default app.uuid_generate_v7(),
  item_id uuid not null references app.self_care_items(id) on delete cascade,
  title text not null,
  description text not null default '',
  counts_as_completion boolean not null default true,
  constraint self_care_item_alternatives_title_not_blank check (length(btrim(title)) > 0)
);

create table if not exists app.self_care_schedule_rules (
  id uuid primary key default app.uuid_generate_v7(),
  item_id uuid not null references app.self_care_items(id) on delete cascade,
  repeat_kind app.self_care_repeat_kind not null,
  interval_value integer,
  interval_unit app.self_care_interval_unit,
  days_of_week smallint[] not null default array[]::smallint[],
  day_of_month smallint,
  week_of_month smallint,
  month_of_year smallint,
  start_date date,
  end_date date,
  preferred_time time,
  timezone text,
  flexible_target_count integer,
  flexible_period app.self_care_flexible_period,
  allow_multiple_per_day boolean not null default false,
  reminder_offsets_minutes integer[] not null default array[]::integer[],
  generate_in_calendar boolean not null default false,
  generate_in_task_list boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint self_care_schedule_interval_positive check (interval_value is null or interval_value > 0),
  constraint self_care_schedule_day_of_month_valid check (day_of_month is null or day_of_month between 1 and 31),
  constraint self_care_schedule_week_of_month_valid check (week_of_month is null or week_of_month between -1 and 5),
  constraint self_care_schedule_month_of_year_valid check (month_of_year is null or month_of_year between 1 and 12),
  constraint self_care_schedule_days_valid check (days_of_week <@ array[1, 2, 3, 4, 5, 6, 7]::smallint[]),
  constraint self_care_schedule_date_range_valid check (end_date is null or start_date is null or end_date >= start_date),
  constraint self_care_schedule_interval_required check (repeat_kind not in ('interval', 'after_completion') or (interval_value is not null and interval_unit is not null)),
  constraint self_care_schedule_flexible_required check (repeat_kind <> 'flexible_goal' or (flexible_target_count is not null and flexible_period is not null))
);

create table if not exists app.self_care_occurrences (
  id uuid primary key default app.uuid_generate_v7(),
  item_id uuid not null references app.self_care_items(id) on delete cascade,
  user_id uuid not null references app.users(id) on delete cascade,
  schedule_rule_id uuid references app.self_care_schedule_rules(id) on delete set null,
  scheduled_for date not null,
  due_at timestamptz,
  status app.self_care_occurrence_status not null default 'scheduled',
  completed_at timestamptz,
  moved_to date,
  generated_at timestamptz,
  created_by uuid references app.users(id),
  updated_by uuid references app.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  version bigint not null default 1
);

create table if not exists app.self_care_completions (
  id uuid primary key default app.uuid_generate_v7(),
  item_id uuid not null references app.self_care_items(id) on delete cascade,
  user_id uuid not null references app.users(id) on delete cascade,
  occurrence_id uuid references app.self_care_occurrences(id) on delete set null,
  status app.self_care_completion_status not null,
  completed_at timestamptz not null,
  scheduled_for date,
  note text not null default '',
  duration_minutes integer,
  mood_before smallint,
  mood_after smallint,
  energy_before smallint,
  energy_after smallint,
  completed_variant app.self_care_completed_variant,
  alternative_title text,
  created_by uuid references app.users(id),
  created_at timestamptz not null default now(),
  constraint self_care_completions_duration_positive check (duration_minutes is null or duration_minutes > 0),
  constraint self_care_completions_mood_before_valid check (mood_before is null or mood_before between 1 and 5),
  constraint self_care_completions_mood_after_valid check (mood_after is null or mood_after between 1 and 5),
  constraint self_care_completions_energy_before_valid check (energy_before is null or energy_before between 1 and 5),
  constraint self_care_completions_energy_after_valid check (energy_after is null or energy_after between 1 and 5)
);

create table if not exists app.self_care_ritual_steps (
  id uuid primary key default app.uuid_generate_v7(),
  item_id uuid not null references app.self_care_items(id) on delete cascade,
  title text not null,
  sort_order integer not null default 0,
  is_optional boolean not null default false,
  default_checked boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint self_care_ritual_steps_title_not_blank check (length(btrim(title)) > 0)
);

create table if not exists app.self_care_ritual_step_completions (
  id uuid primary key default app.uuid_generate_v7(),
  completion_id uuid not null references app.self_care_completions(id) on delete cascade,
  step_id uuid not null references app.self_care_ritual_steps(id) on delete cascade,
  is_done boolean not null default false
);

create table if not exists app.self_care_procedure_details (
  id uuid primary key default app.uuid_generate_v7(),
  item_id uuid not null references app.self_care_items(id) on delete cascade,
  specialist_name text,
  place text,
  contact text,
  default_price numeric(12, 2),
  currency text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint self_care_procedure_default_price_nonnegative check (default_price is null or default_price >= 0)
);

create table if not exists app.self_care_appointment_details (
  id uuid primary key default app.uuid_generate_v7(),
  item_id uuid not null references app.self_care_items(id) on delete cascade,
  occurrence_id uuid references app.self_care_occurrences(id) on delete set null,
  starts_at timestamptz not null,
  ends_at timestamptz,
  place text,
  specialist_name text,
  specialist_contact text,
  price numeric(12, 2),
  currency text,
  preparation_note text,
  result_note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint self_care_appointment_price_nonnegative check (price is null or price >= 0),
  constraint self_care_appointment_range_valid check (ends_at is null or ends_at >= starts_at)
);

create table if not exists app.self_care_medical_details (
  id uuid primary key default app.uuid_generate_v7(),
  item_id uuid not null references app.self_care_items(id) on delete cascade,
  doctor_name text,
  clinic_name text,
  clinic_address text,
  phone text,
  website text,
  analysis_list text[] not null default array[]::text[],
  result_note text,
  next_control_date date,
  document_urls text[] not null default array[]::text[],
  reminder_strategy app.self_care_reminder_strategy not null default 'soft',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists app.self_care_course_details (
  id uuid primary key default app.uuid_generate_v7(),
  item_id uuid not null references app.self_care_items(id) on delete cascade,
  course_type app.self_care_course_type not null,
  total_count integer not null,
  completed_count integer not null default 0,
  start_date date,
  end_date date,
  is_paused boolean not null default false,
  is_completed boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint self_care_course_total_positive check (total_count > 0),
  constraint self_care_course_completed_nonnegative check (completed_count >= 0),
  constraint self_care_course_completed_lte_total check (completed_count <= total_count),
  constraint self_care_course_date_range_valid check (end_date is null or start_date is null or end_date >= start_date)
);

create table if not exists app.self_care_daily_states (
  id uuid primary key default app.uuid_generate_v7(),
  user_id uuid not null references app.users(id) on delete cascade,
  date date not null,
  mood smallint,
  energy smallint,
  stress smallint,
  sleep_quality smallint,
  pain smallint,
  note text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint self_care_daily_state_mood_valid check (mood is null or mood between 1 and 5),
  constraint self_care_daily_state_energy_valid check (energy is null or energy between 1 and 5),
  constraint self_care_daily_state_stress_valid check (stress is null or stress between 1 and 5),
  constraint self_care_daily_state_sleep_valid check (sleep_quality is null or sleep_quality between 1 and 5),
  constraint self_care_daily_state_pain_valid check (pain is null or pain between 1 and 5)
);

create table if not exists app.self_care_templates (
  id text primary key,
  title text not null,
  description text not null default '',
  type app.self_care_item_type not null,
  category app.self_care_category not null,
  importance app.self_care_importance not null,
  default_schedule jsonb,
  default_steps text[] not null default array[]::text[],
  icon text,
  color text,
  is_system boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint self_care_templates_title_not_blank check (length(btrim(title)) > 0)
);

create table if not exists app.self_care_settings (
  id uuid primary key default app.uuid_generate_v7(),
  user_id uuid not null references app.users(id) on delete cascade,
  gentle_mode_enabled_today boolean not null default false,
  gentle_mode_date date,
  show_self_care_in_main_tasks boolean not null default true,
  show_appointments_in_calendar boolean not null default true,
  show_daily_rituals_in_calendar boolean not null default false,
  quiet_hours_start time,
  quiet_hours_end time,
  default_reminder_tone app.self_care_reminder_tone not null default 'soft',
  currency text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists app.self_care_minimum_items (
  id uuid primary key default app.uuid_generate_v7(),
  user_id uuid not null references app.users(id) on delete cascade,
  title text not null,
  linked_item_id uuid references app.self_care_items(id) on delete set null,
  sort_order integer not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint self_care_minimum_items_title_not_blank check (length(btrim(title)) > 0)
);

create index if not exists self_care_items_user_idx on app.self_care_items (user_id) where deleted_at is null;
create index if not exists self_care_items_user_active_archived_idx on app.self_care_items (user_id, is_active, is_archived) where deleted_at is null;
create index if not exists self_care_items_user_type_idx on app.self_care_items (user_id, type) where deleted_at is null;
create index if not exists self_care_items_user_category_idx on app.self_care_items (user_id, category) where deleted_at is null;
create unique index if not exists self_care_items_migrated_habit_idx on app.self_care_items (migrated_from_habit_id) where migrated_from_habit_id is not null;
create index if not exists self_care_schedule_rules_item_idx on app.self_care_schedule_rules (item_id);
create index if not exists self_care_occurrences_user_scheduled_idx on app.self_care_occurrences (user_id, scheduled_for);
create index if not exists self_care_occurrences_user_status_idx on app.self_care_occurrences (user_id, status);
create index if not exists self_care_occurrences_item_scheduled_idx on app.self_care_occurrences (item_id, scheduled_for);
create unique index if not exists self_care_occurrences_unique_generated_idx on app.self_care_occurrences (item_id, schedule_rule_id, scheduled_for) where schedule_rule_id is not null;
create index if not exists self_care_completions_user_completed_idx on app.self_care_completions (user_id, completed_at);
create index if not exists self_care_completions_item_completed_idx on app.self_care_completions (item_id, completed_at);
create unique index if not exists self_care_daily_states_user_date_idx on app.self_care_daily_states (user_id, date);
create unique index if not exists self_care_settings_user_idx on app.self_care_settings (user_id);
create index if not exists self_care_minimum_items_user_order_idx on app.self_care_minimum_items (user_id, sort_order);

insert into app.self_care_templates (id, title, description, type, category, importance, default_schedule, default_steps, is_system)
values
  ('system-self-care-template-1', 'Медицинский чекап', 'Раз в год: сохранить дату и результаты без медицинских интерпретаций.', 'medical', 'medical', 'required', '{"repeatKind":"yearly","reminderOffsetsMinutes":[43200,10080,1440]}'::jsonb, array[]::text[], true),
  ('system-self-care-template-2', 'Стоматолог', 'Мягкое напоминание раз в 6 месяцев.', 'medical', 'medical', 'required', '{"repeatKind":"after_completion","intervalValue":6,"intervalUnit":"month","reminderOffsetsMinutes":[43200,10080,1440]}'::jsonb, array[]::text[], true),
  ('system-self-care-template-3', 'Маникюр', 'Каждые 4 недели после выполнения.', 'procedure', 'beauty', 'recommended', '{"repeatKind":"after_completion","intervalValue":4,"intervalUnit":"week"}'::jsonb, array[]::text[], true),
  ('system-self-care-template-4', 'Педикюр', 'Каждые 5 недель после выполнения.', 'procedure', 'beauty', 'recommended', '{"repeatKind":"after_completion","intervalValue":5,"intervalUnit":"week"}'::jsonb, array[]::text[], true),
  ('system-self-care-template-5', 'SPF', 'Каждое утро.', 'habit', 'daily_base', 'recommended', '{"repeatKind":"daily","preferredTime":"09:00"}'::jsonb, array[]::text[], true),
  ('system-self-care-template-6', 'Утренний уход', 'Ритуал с мягким чеклистом.', 'ritual', 'beauty', 'recommended', '{"repeatKind":"daily","preferredTime":"08:30"}'::jsonb, array['умыться', 'тоник', 'сыворотка', 'крем', 'SPF'], true),
  ('system-self-care-template-7', 'Вечерний уход', 'Можно сделать полную или минимальную версию.', 'ritual', 'beauty', 'gentle', '{"repeatKind":"daily","preferredTime":"21:30"}'::jsonb, array['снять макияж', 'умыться', 'актив', 'крем', 'крем для рук'], true),
  ('system-self-care-template-8', 'Йога', '3 раза в неделю.', 'flexible_goal', 'movement', 'recommended', '{"repeatKind":"flexible_goal","flexibleTargetCount":3,"flexiblePeriod":"week"}'::jsonb, array[]::text[], true),
  ('system-self-care-template-9', 'Прогулка', '5 раз в неделю.', 'flexible_goal', 'movement', 'gentle', '{"repeatKind":"flexible_goal","flexibleTargetCount":5,"flexiblePeriod":"week"}'::jsonb, array[]::text[], true),
  ('system-self-care-template-10', 'Релакс 20 минут', '3 раза в неделю.', 'flexible_goal', 'relax', 'gentle', '{"repeatKind":"flexible_goal","flexibleTargetCount":3,"flexiblePeriod":"week"}'::jsonb, array[]::text[], true),
  ('system-self-care-template-11', 'Витамины', 'Курс на 30 дней.', 'course', 'health', 'recommended', '{"repeatKind":"course"}'::jsonb, array[]::text[], true),
  ('system-self-care-template-12', 'Дневник состояния', 'Отметка без обязательности.', 'mood_check', 'emotional', 'gentle', '{"repeatKind":"daily"}'::jsonb, array[]::text[], true)
on conflict (id) do nothing;

insert into app.self_care_items (
  id, workspace_id, user_id, title, description, type, category, importance, icon, color,
  is_active, is_archived, is_private, preferred_time_of_day, default_duration_minutes,
  migrated_from_habit_id, created_by, updated_by, created_at, updated_at
)
select
  app.uuid_generate_v7(), h.workspace_id, h.user_id, h.title, h.description, 'habit', 'daily_base', 'recommended', h.icon, h.color,
  h.is_active, false, true,
  case
    when h.reminder_time is null then 'anytime'::app.self_care_time_of_day
    when h.reminder_time < time '06:00' then 'night'::app.self_care_time_of_day
    when h.reminder_time < time '12:00' then 'morning'::app.self_care_time_of_day
    when h.reminder_time < time '18:00' then 'afternoon'::app.self_care_time_of_day
    when h.reminder_time < time '23:00' then 'evening'::app.self_care_time_of_day
    else 'night'::app.self_care_time_of_day
  end,
  case when h.target_type = 'duration' then h.target_value else null end,
  h.id, h.created_by, h.updated_by, h.created_at, h.updated_at
from app.habits h
where h.deleted_at is null
on conflict (migrated_from_habit_id) where migrated_from_habit_id is not null do nothing;

insert into app.self_care_schedule_rules (
  item_id, repeat_kind, days_of_week, start_date, end_date, preferred_time,
  generate_in_calendar, generate_in_task_list, created_at, updated_at
)
select
  i.id,
  case when h.frequency = 'daily' then 'daily'::app.self_care_repeat_kind else 'weekly'::app.self_care_repeat_kind end,
  h.days_of_week,
  h.start_date,
  h.end_date,
  h.reminder_time,
  false,
  true,
  h.created_at,
  h.updated_at
from app.self_care_items i
join app.habits h on h.id = i.migrated_from_habit_id
where not exists (
  select 1 from app.self_care_schedule_rules r where r.item_id = i.id
);

insert into app.self_care_completions (
  item_id, user_id, status, completed_at, scheduled_for, note, created_by, created_at
)
select
  i.id,
  e.user_id,
  case when e.status = 'skipped' then 'skipped'::app.self_care_completion_status else 'done'::app.self_care_completion_status end,
  e.date::timestamptz + interval '12 hours',
  e.date,
  e.note,
  e.created_by,
  e.created_at
from app.self_care_items i
join app.habit_entries e on e.habit_id = i.migrated_from_habit_id
where e.deleted_at is null
  and not exists (
    select 1
    from app.self_care_completions c
    where c.item_id = i.id
      and c.scheduled_for = e.date
  );

insert into app.self_care_settings (user_id, currency, quiet_hours_start, quiet_hours_end)
select distinct user_id, 'RUB', time '22:00', time '08:00'
from app.self_care_items
on conflict (user_id) do nothing;

insert into app.self_care_minimum_items (user_id, title, sort_order)
select user_id, title, sort_order
from (
  select distinct user_id from app.self_care_items
) users
cross join (values
  ('вода', 0),
  ('еда', 1),
  ('умыться', 2),
  ('выйти на воздух', 3),
  ('лечь спать', 4)
) defaults(title, sort_order)
where not exists (
  select 1 from app.self_care_minimum_items existing where existing.user_id = users.user_id
);

do $$
declare
  table_name text;
begin
  foreach table_name in array array[
    'self_care_items',
    'self_care_occurrences'
  ] loop
    execute format('drop trigger if exists %I on app.%I', table_name || '_bump_row_version', table_name);
    execute format('create trigger %I before update on app.%I for each row execute function app.bump_row_version()', table_name || '_bump_row_version', table_name);
  end loop;
end $$;

grant select, insert, update, delete on table
  app.self_care_items,
  app.self_care_item_alternatives,
  app.self_care_schedule_rules,
  app.self_care_occurrences,
  app.self_care_completions,
  app.self_care_ritual_steps,
  app.self_care_ritual_step_completions,
  app.self_care_procedure_details,
  app.self_care_appointment_details,
  app.self_care_medical_details,
  app.self_care_course_details,
  app.self_care_daily_states,
  app.self_care_settings,
  app.self_care_minimum_items
  to authenticated;

grant select on table app.self_care_templates to authenticated;

alter table app.self_care_items enable row level security;
alter table app.self_care_item_alternatives enable row level security;
alter table app.self_care_schedule_rules enable row level security;
alter table app.self_care_occurrences enable row level security;
alter table app.self_care_completions enable row level security;
alter table app.self_care_ritual_steps enable row level security;
alter table app.self_care_ritual_step_completions enable row level security;
alter table app.self_care_procedure_details enable row level security;
alter table app.self_care_appointment_details enable row level security;
alter table app.self_care_medical_details enable row level security;
alter table app.self_care_course_details enable row level security;
alter table app.self_care_daily_states enable row level security;
alter table app.self_care_templates enable row level security;
alter table app.self_care_settings enable row level security;
alter table app.self_care_minimum_items enable row level security;

create policy self_care_templates_select_all on app.self_care_templates for select to authenticated using (true);

create policy self_care_items_select_private on app.self_care_items for select to authenticated using (
  (select app.workspace_is_accessible(workspace_id)) and user_id = (select app.current_user_id()) and deleted_at is null
);
create policy self_care_items_insert_private on app.self_care_items for insert to authenticated with check (
  (select app.workspace_has_write_access(workspace_id)) and user_id = (select app.current_user_id()) and created_by = (select app.current_user_id()) and updated_by = (select app.current_user_id())
);
create policy self_care_items_update_private on app.self_care_items for update to authenticated using (
  (select app.workspace_has_write_access(workspace_id)) and user_id = (select app.current_user_id())
) with check (
  (select app.workspace_has_write_access(workspace_id)) and user_id = (select app.current_user_id()) and updated_by = (select app.current_user_id())
);
create policy self_care_items_delete_private on app.self_care_items for delete to authenticated using (
  (select app.workspace_has_write_access(workspace_id)) and user_id = (select app.current_user_id())
);

create policy self_care_daily_states_private on app.self_care_daily_states for all to authenticated using (user_id = (select app.current_user_id())) with check (user_id = (select app.current_user_id()));
create policy self_care_settings_private on app.self_care_settings for all to authenticated using (user_id = (select app.current_user_id())) with check (user_id = (select app.current_user_id()));
create policy self_care_minimum_items_private on app.self_care_minimum_items for all to authenticated using (user_id = (select app.current_user_id())) with check (user_id = (select app.current_user_id()));
create policy self_care_occurrences_private on app.self_care_occurrences for all to authenticated using (user_id = (select app.current_user_id())) with check (user_id = (select app.current_user_id()));
create policy self_care_completions_private on app.self_care_completions for all to authenticated using (user_id = (select app.current_user_id())) with check (user_id = (select app.current_user_id()));

create policy self_care_item_children_private on app.self_care_item_alternatives for all to authenticated using (
  exists (select 1 from app.self_care_items i where i.id = item_id and i.user_id = (select app.current_user_id()) and i.deleted_at is null)
) with check (
  exists (select 1 from app.self_care_items i where i.id = item_id and i.user_id = (select app.current_user_id()) and i.deleted_at is null)
);

create policy self_care_schedule_rules_private on app.self_care_schedule_rules for all to authenticated using (
  exists (select 1 from app.self_care_items i where i.id = item_id and i.user_id = (select app.current_user_id()) and i.deleted_at is null)
) with check (
  exists (select 1 from app.self_care_items i where i.id = item_id and i.user_id = (select app.current_user_id()) and i.deleted_at is null)
);

create policy self_care_ritual_steps_private on app.self_care_ritual_steps for all to authenticated using (
  exists (select 1 from app.self_care_items i where i.id = item_id and i.user_id = (select app.current_user_id()) and i.deleted_at is null)
) with check (
  exists (select 1 from app.self_care_items i where i.id = item_id and i.user_id = (select app.current_user_id()) and i.deleted_at is null)
);

create policy self_care_ritual_step_completions_private on app.self_care_ritual_step_completions for all to authenticated using (
  exists (
    select 1 from app.self_care_completions c where c.id = completion_id and c.user_id = (select app.current_user_id())
  )
) with check (
  exists (
    select 1 from app.self_care_completions c where c.id = completion_id and c.user_id = (select app.current_user_id())
  )
);

create policy self_care_procedure_details_private on app.self_care_procedure_details for all to authenticated using (
  exists (select 1 from app.self_care_items i where i.id = item_id and i.user_id = (select app.current_user_id()) and i.deleted_at is null)
) with check (
  exists (select 1 from app.self_care_items i where i.id = item_id and i.user_id = (select app.current_user_id()) and i.deleted_at is null)
);

create policy self_care_appointment_details_private on app.self_care_appointment_details for all to authenticated using (
  exists (select 1 from app.self_care_items i where i.id = item_id and i.user_id = (select app.current_user_id()) and i.deleted_at is null)
) with check (
  exists (select 1 from app.self_care_items i where i.id = item_id and i.user_id = (select app.current_user_id()) and i.deleted_at is null)
);

create policy self_care_medical_details_private on app.self_care_medical_details for all to authenticated using (
  exists (select 1 from app.self_care_items i where i.id = item_id and i.user_id = (select app.current_user_id()) and i.deleted_at is null)
) with check (
  exists (select 1 from app.self_care_items i where i.id = item_id and i.user_id = (select app.current_user_id()) and i.deleted_at is null)
);

create policy self_care_course_details_private on app.self_care_course_details for all to authenticated using (
  exists (select 1 from app.self_care_items i where i.id = item_id and i.user_id = (select app.current_user_id()) and i.deleted_at is null)
) with check (
  exists (select 1 from app.self_care_items i where i.id = item_id and i.user_id = (select app.current_user_id()) and i.deleted_at is null)
);
