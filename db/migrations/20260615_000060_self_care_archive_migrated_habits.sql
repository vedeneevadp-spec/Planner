-- noinspection SqlNoDataSourceInspection
create or replace function app.soft_delete_self_care_item(
  input_item_id uuid,
  input_workspace_id uuid,
  input_actor_user_id uuid
)
returns table(deleted boolean, migrated_from_habit_id uuid)
language plpgsql
security definer
set search_path = app, pg_temp
as $$
declare
  claims_user_id uuid := app.current_user_id();
  deleted_timestamp timestamptz := now();
  linked_habit_id uuid;
  updated_count integer := 0;
begin
  if claims_user_id is null or claims_user_id <> input_actor_user_id then
    raise insufficient_privilege
      using message = 'soft_delete_self_care_item requires current JWT subject to match actor user.';
  end if;

  if not app.workspace_has_write_access(input_workspace_id) then
    raise insufficient_privilege
      using message = 'soft_delete_self_care_item requires workspace write access.';
  end if;

  select item.migrated_from_habit_id
  into linked_habit_id
  from self_care_items item
  where item.id = input_item_id
    and item.workspace_id = input_workspace_id
    and item.user_id = input_actor_user_id
    and item.deleted_at is null;

  if not found then
    return query select false, null::uuid;
    return;
  end if;

  update self_care_items
  set
    deleted_at = deleted_timestamp,
    is_active = false,
    is_archived = true,
    updated_by = input_actor_user_id
  where id = input_item_id
    and workspace_id = input_workspace_id
    and user_id = input_actor_user_id
    and deleted_at is null;

  get diagnostics updated_count = row_count;

  return query select updated_count > 0, linked_habit_id;
end;
$$;

grant execute on function app.soft_delete_self_care_item(uuid, uuid, uuid)
  to authenticated;

update app.habits as habit
set
  is_active = false,
  deleted_at = case
    when item.deleted_at is not null then coalesce(habit.deleted_at, item.deleted_at)
    else habit.deleted_at
  end,
  updated_by = coalesce(item.updated_by, item.created_by, habit.updated_by)
from app.self_care_items as item
where item.migrated_from_habit_id = habit.id
  and (
    item.is_archived
    or not item.is_active
    or item.deleted_at is not null
  )
  and (
    habit.is_active
    or (item.deleted_at is not null and habit.deleted_at is null)
  );
