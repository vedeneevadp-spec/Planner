-- noinspection SqlNoDataSourceInspection
alter table app.habit_entries
  add column if not exists target_value integer;

update app.habit_entries entry
set target_value = habit.target_value
from app.habits habit
where entry.habit_id = habit.id
  and entry.target_value is null;

update app.habit_entries
set target_value = greatest(value, 1)
where target_value is null;

alter table app.habit_entries
  alter column target_value set default 1,
  alter column target_value set not null;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where connamespace = 'app'::regnamespace
      and conname = 'habit_entries_target_value_positive'
  ) then
    alter table app.habit_entries
      add constraint habit_entries_target_value_positive check (target_value > 0);
  end if;
end $$;
