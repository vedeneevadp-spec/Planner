-- The task-event outbox never had a production consumer. Remove the trigger
-- first so task writes stop creating records, then remove every runtime and
-- maintenance artifact owned by the retired pipeline.

drop trigger if exists task_events_enqueue_outbox on app.task_events;
drop function if exists app.enqueue_task_event_outbox();

do $$
begin
  if to_regnamespace('cron') is not null then
    begin
      perform cron.unschedule(jobid)
      from cron.job
      where jobname = 'planner-prune-completed-outbox';
    exception
      when invalid_schema_name or undefined_function or undefined_table then null;
    end;
  end if;

  if to_regprocedure('pgmq.drop_queue(text)') is not null then
    begin
      execute 'select pgmq.drop_queue($1)' using 'planner_task_events';
    exception
      when invalid_schema_name or undefined_function or undefined_table then null;
    end;
  end if;
end;
$$;

drop function if exists app.prune_completed_outbox(interval);
drop table if exists app.outbox;
drop type if exists app.outbox_status;

-- Rebind account deletion without the retired table dependency. PostgreSQL
-- does not eagerly validate PL/pgSQL relation references, so leaving the old
-- function body in place would make the next account deletion fail at runtime.
create or replace function app.delete_user_account(target_user_id uuid)
returns boolean
language plpgsql
security definer
set search_path = app, pg_catalog, pg_temp
as $$
declare
  actor_user_id uuid := app.current_user_id();
  deleted_account boolean := false;
  original_claims text := current_setting('request.jwt.claims', true);
  reference_row record;
  target_role app.app_role;
begin
  select app_role
  into target_role
  from app.users
  where id = target_user_id
    and deleted_at is null;

  if not found then
    return false;
  end if;

  if actor_user_id is null then
    return false;
  end if;

  if target_role = 'owner'::app.app_role then
    raise exception 'The global owner account cannot be deleted.'
      using errcode = '42501';
  end if;

  if actor_user_id <> target_user_id
    and (select app.current_user_app_role()) <> 'owner'::app.app_role
  then
    raise exception 'Account deletion is not allowed.'
      using errcode = '42501';
  end if;

  delete from app.mcp_audit_logs
  where user_id = target_user_id;

  delete from app.workspaces
  where owner_user_id = target_user_id;

  perform set_config('request.jwt.claims', '{}', true);

  for reference_row in
    select
      constraint_row.conrelid::regclass as table_name,
      attribute_row.attname as column_name
    from pg_constraint as constraint_row
    inner join pg_attribute as attribute_row
      on attribute_row.attrelid = constraint_row.conrelid
      and attribute_row.attnum = constraint_row.conkey[1]
    where constraint_row.contype = 'f'
      and constraint_row.confrelid = 'app.users'::regclass
      and constraint_row.confdeltype = 'a'
      and cardinality(constraint_row.conkey) = 1
      and not attribute_row.attnotnull
  loop
    execute format(
      'update %s set %I = null where %I = $1',
      reference_row.table_name,
      reference_row.column_name,
      reference_row.column_name
    )
    using target_user_id;
  end loop;

  delete from app.users
  where id = target_user_id
    and app_role <> 'owner'::app.app_role
    and deleted_at is null;

  deleted_account := found;

  perform set_config(
    'request.jwt.claims',
    coalesce(nullif(original_claims, ''), '{}'),
    true
  );

  return deleted_account;
end
$$;

revoke all on function app.delete_user_account(uuid) from public;
grant execute on function app.delete_user_account(uuid) to authenticated;
