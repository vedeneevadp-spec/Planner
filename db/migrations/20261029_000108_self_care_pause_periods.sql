alter table app.self_care_items
  add column pause_periods jsonb not null default '[]'::jsonb
  check (jsonb_typeof(pause_periods) = 'array');
