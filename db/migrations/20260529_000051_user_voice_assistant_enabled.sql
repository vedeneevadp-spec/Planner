-- noinspection SqlNoDataSourceInspection
alter table app.users
  add column if not exists voice_assistant_enabled boolean not null default true;

create or replace function app.update_current_user_preferences(
  input_calendar_view_mode text default null,
  input_energy_mode text default null,
  input_voice_assistant_enabled boolean default null
)
returns table (
  calendar_view_mode text,
  energy_mode text,
  voice_assistant_enabled boolean
)
language plpgsql
security definer
set search_path = app, pg_temp
as $$
declare
  claims_user_id uuid := app.current_user_id();
begin
  if claims_user_id is null then
    raise insufficient_privilege
      using message = 'update_current_user_preferences requires an authenticated JWT subject.';
  end if;

  return query
    update users as user_row
    set
      calendar_view_mode = coalesce(
        input_calendar_view_mode,
        user_row.calendar_view_mode
      ),
      energy_mode = coalesce(input_energy_mode, user_row.energy_mode),
      voice_assistant_enabled = coalesce(
        input_voice_assistant_enabled,
        user_row.voice_assistant_enabled
      )
    where user_row.id = claims_user_id
      and user_row.deleted_at is null
    returning
      user_row.calendar_view_mode,
      user_row.energy_mode,
      user_row.voice_assistant_enabled;
end;
$$;

grant execute on function app.update_current_user_preferences(text, text, boolean)
  to authenticated;
