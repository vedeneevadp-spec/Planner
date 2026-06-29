alter type app.self_care_item_type add value if not exists 'exercise';

alter table app.self_care_completions
  add column if not exists exercise_sets jsonb not null default '[]'::jsonb;

create table if not exists app.self_care_exercise_details (
  id uuid primary key default app.uuid_generate_v7(),
  item_id uuid not null references app.self_care_items(id) on delete cascade,
  metric_type text not null,
  unit text not null,
  use_sets boolean not null default false,
  planned_value numeric(12, 4),
  planned_sets integer,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint self_care_exercise_details_metric_valid check (
    metric_type in ('weight', 'time', 'count', 'distance')
  ),
  constraint self_care_exercise_details_unit_valid check (
    unit in ('kg', 'min', 'reps', 'm', 'km')
  ),
  constraint self_care_exercise_details_planned_sets_positive check (
    planned_sets is null or planned_sets > 0
  )
);

create unique index if not exists self_care_exercise_details_item_idx
  on app.self_care_exercise_details (item_id);

grant select, insert, update, delete on table
  app.self_care_exercise_details
  to authenticated;

alter table app.self_care_exercise_details enable row level security;

drop policy if exists self_care_exercise_details_private
  on app.self_care_exercise_details;

create policy self_care_exercise_details_private
  on app.self_care_exercise_details
  for all
  to authenticated
  using (
    exists (
      select 1
      from app.self_care_items item
      where item.id = item_id
        and item.user_id = (select app.current_user_id())
        and item.deleted_at is null
    )
  )
  with check (
    exists (
      select 1
      from app.self_care_items item
      where item.id = item_id
        and item.user_id = (select app.current_user_id())
        and item.deleted_at is null
    )
  );
