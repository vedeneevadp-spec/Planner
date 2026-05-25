-- noinspection SqlNoDataSourceInspection
create or replace function app.soft_delete_cleaning_task(
  input_task_id uuid,
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
  updated_count integer := 0;
begin
  if claims_user_id is null or claims_user_id <> input_actor_user_id then
    raise insufficient_privilege
      using message = 'soft_delete_cleaning_task requires current JWT subject to match actor user.';
  end if;

  if not app.workspace_has_write_access(input_workspace_id) then
    raise insufficient_privilege
      using message = 'soft_delete_cleaning_task requires workspace write access.';
  end if;

  update cleaning_tasks
  set
    deleted_at = now(),
    is_active = false,
    updated_by = input_actor_user_id
  where id = input_task_id
    and workspace_id = input_workspace_id
    and deleted_at is null;

  get diagnostics updated_count = row_count;

  return updated_count > 0;
end;
$$;

create or replace function app.soft_delete_cleaning_zone(
  input_zone_id uuid,
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
  updated_count integer := 0;
begin
  if claims_user_id is null or claims_user_id <> input_actor_user_id then
    raise insufficient_privilege
      using message = 'soft_delete_cleaning_zone requires current JWT subject to match actor user.';
  end if;

  if not app.workspace_has_write_access(input_workspace_id) then
    raise insufficient_privilege
      using message = 'soft_delete_cleaning_zone requires workspace write access.';
  end if;

  update cleaning_zones
  set
    deleted_at = now(),
    is_active = false,
    updated_by = input_actor_user_id
  where id = input_zone_id
    and workspace_id = input_workspace_id
    and deleted_at is null;

  get diagnostics updated_count = row_count;

  if updated_count = 0 then
    return false;
  end if;

  update cleaning_tasks
  set
    deleted_at = now(),
    is_active = false,
    updated_by = input_actor_user_id
  where zone_id = input_zone_id
    and workspace_id = input_workspace_id
    and deleted_at is null;

  return true;
end;
$$;

grant execute on function app.soft_delete_cleaning_task(uuid, uuid, uuid)
  to authenticated;
grant execute on function app.soft_delete_cleaning_zone(uuid, uuid, uuid)
  to authenticated;
