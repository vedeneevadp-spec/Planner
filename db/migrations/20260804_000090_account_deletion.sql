-- noinspection SqlNoDataSourceInspection

-- Account deletion follows the crash-safe refresh rotation migration from the
-- same release, so it uses the next migration sequence number.

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

  delete from app.outbox
  where aggregate_id = target_user_id
    or payload::text like '%' || target_user_id::text || '%'
    or payload ->> 'workspaceId' in (
      select workspace.id::text
      from app.workspaces as workspace
      where workspace.owner_user_id = target_user_id
    );

  delete from app.mcp_audit_logs
  where user_id = target_user_id;

  delete from app.workspaces
  where owner_user_id = target_user_id;

  -- Maintenance updates must bypass request-level immutability triggers while
  -- clearing nullable author, updater and inviter references in workspaces that
  -- belong to other users. The original claims are restored before returning.
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
