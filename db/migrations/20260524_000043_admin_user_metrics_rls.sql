-- noinspection SqlNoDataSourceInspection
create or replace function app.admin_user_task_count(target_user_id uuid)
returns integer
language sql
stable
security definer
set search_path = app, pg_temp
as $$
  select case
    when (select app.current_user_app_role()) = 'owner' then (
      select count(*)::int
      from app.tasks as task
      where task.created_by = target_user_id
        and task.deleted_at is null
    )
    else 0
  end
$$;

create or replace function app.admin_user_last_seen_at(target_user_id uuid)
returns timestamptz
language sql
stable
security definer
set search_path = app, pg_temp
as $$
  select case
    when (select app.current_user_app_role()) = 'owner' then (
      select max(coalesce(token.last_used_at, token.created_at))
      from app.auth_refresh_tokens as token
      where token.user_id = target_user_id
    )
    else null::timestamptz
  end
$$;

grant execute on function app.admin_user_task_count(uuid) to authenticated;
grant execute on function app.admin_user_last_seen_at(uuid) to authenticated;
