-- noinspection SqlNoDataSourceInspection
create or replace function app.soft_delete_habit(
  input_habit_id uuid,
  input_workspace_id uuid,
  input_actor_user_id uuid
)
returns boolean
language plpgsql
security definer
set search_path = app, pg_temp
as $$
declare
  claims_user_id uuid := app.current_user_id();
  deleted_timestamp timestamptz := now();
  updated_count integer := 0;
begin
  if claims_user_id is null or claims_user_id <> input_actor_user_id then
    raise insufficient_privilege
      using message = 'soft_delete_habit requires current JWT subject to match actor user.';
  end if;

  if not app.workspace_has_write_access(input_workspace_id) then
    raise insufficient_privilege
      using message = 'soft_delete_habit requires workspace write access.';
  end if;

  update habits
  set
    deleted_at = deleted_timestamp,
    is_active = false,
    updated_by = input_actor_user_id
  where id = input_habit_id
    and workspace_id = input_workspace_id
    and deleted_at is null;

  get diagnostics updated_count = row_count;

  if updated_count = 0 then
    return false;
  end if;

  update habit_entries
  set
    deleted_at = deleted_timestamp,
    updated_by = input_actor_user_id
  where habit_id = input_habit_id
    and workspace_id = input_workspace_id
    and deleted_at is null;

  return true;
end;
$$;

create or replace function app.soft_delete_habit_entry(
  input_habit_id uuid,
  input_workspace_id uuid,
  input_actor_user_id uuid,
  input_date date,
  input_expected_version bigint default null
)
returns table(deleted boolean, actual_version bigint)
language plpgsql
security definer
set search_path = app, pg_temp
as $$
declare
  claims_user_id uuid := app.current_user_id();
  deleted_timestamp timestamptz := now();
  updated_count integer := 0;
begin
  if claims_user_id is null or claims_user_id <> input_actor_user_id then
    raise insufficient_privilege
      using message = 'soft_delete_habit_entry requires current JWT subject to match actor user.';
  end if;

  if not app.workspace_has_write_access(input_workspace_id) then
    raise insufficient_privilege
      using message = 'soft_delete_habit_entry requires workspace write access.';
  end if;

  update habit_entries
  set
    deleted_at = deleted_timestamp,
    updated_by = input_actor_user_id
  where habit_id = input_habit_id
    and workspace_id = input_workspace_id
    and date = input_date
    and deleted_at is null
    and (
      input_expected_version is null
      or version = input_expected_version
    );

  get diagnostics updated_count = row_count;

  if updated_count > 0 then
    return query select true, null::bigint;
    return;
  end if;

  return query
  select false, entry.version
  from habit_entries entry
  where entry.habit_id = input_habit_id
    and entry.workspace_id = input_workspace_id
    and entry.date = input_date
    and entry.deleted_at is null
  limit 1;

  if not found then
    return query select false, null::bigint;
  end if;
end;
$$;

grant execute on function app.soft_delete_habit(uuid, uuid, uuid)
  to authenticated;
grant execute on function app.soft_delete_habit_entry(uuid, uuid, uuid, date, bigint)
  to authenticated;
