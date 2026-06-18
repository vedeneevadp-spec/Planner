alter table app.self_care_completions
  add column if not exists measurement_value numeric(12, 4),
  add column if not exists measurement_unit text;

create table if not exists app.self_care_measurement_details (
  id uuid primary key default app.uuid_generate_v7(),
  item_id uuid not null references app.self_care_items(id) on delete cascade,
  value_label text not null default 'Значение',
  unit text not null,
  target_min numeric(12, 4),
  target_max numeric(12, 4),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint self_care_measurement_details_unit_not_blank check (length(btrim(unit)) > 0),
  constraint self_care_measurement_details_value_label_not_blank check (length(btrim(value_label)) > 0),
  constraint self_care_measurement_details_target_range_valid check (
    target_min is null or target_max is null or target_min <= target_max
  )
);

create unique index if not exists self_care_measurement_details_item_idx
  on app.self_care_measurement_details (item_id);

insert into app.self_care_measurement_details (
  item_id,
  target_max,
  target_min,
  unit,
  value_label
)
select
  item.id,
  null,
  null,
  case
    when lower(item.title) like '%вес%' then 'кг'
    when lower(item.title) like '%температур%' then '°C'
    when lower(item.title) like '%пульс%' then 'уд/мин'
    when lower(item.title) like '%давлен%' then 'мм рт. ст.'
    when lower(item.title) like '%сахар%' or lower(item.title) like '%глюкоз%' then 'ммоль/л'
    else 'ед.'
  end,
  case
    when lower(item.title) like '%вес%' then 'Вес'
    when lower(item.title) like '%температур%' then 'Температура'
    when lower(item.title) like '%пульс%' then 'Пульс'
    when lower(item.title) like '%давлен%' then 'Давление'
    when lower(item.title) like '%сахар%' or lower(item.title) like '%глюкоз%' then 'Глюкоза'
    else 'Значение'
  end
from app.self_care_items item
where item.type = 'measurement'
  and item.deleted_at is null
  and not exists (
    select 1
    from app.self_care_measurement_details existing
    where existing.item_id = item.id
  );

grant select, insert, update, delete on table
  app.self_care_measurement_details
  to authenticated;

alter table app.self_care_measurement_details enable row level security;

drop policy if exists self_care_measurement_details_private
  on app.self_care_measurement_details;

create policy self_care_measurement_details_private
  on app.self_care_measurement_details
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
