-- Epochs are live coordination metadata, never restored from a user archive.
create table app.workspace_write_epochs (
  workspace_id uuid primary key references app.workspaces(id) on delete cascade,
  epoch bigint not null default 0 check (epoch >= 0),
  restored_at timestamptz not null
);
alter table app.workspace_write_epochs enable row level security;
create policy planner_backup_select_all on app.workspace_write_epochs
  for select to public using (session_user = 'planner_backup');
do $$ begin
  if exists (select 1 from pg_roles where rolname = 'planner_backup') then
    grant select on app.workspace_write_epochs to planner_backup;
  end if;
end $$;

create function app.read_workspace_write_epoch(p_user_id uuid, p_workspace_id uuid)
returns text language sql stable security definer
set search_path = pg_catalog, app
as $$
  select coalesce(e.epoch, 0)::text from app.workspaces w
  left join app.workspace_write_epochs e on e.workspace_id = w.id
  where w.id = p_workspace_id and w.deleted_at is null
    and exists (select 1 from app.workspace_members m
      where m.workspace_id = w.id and m.user_id = p_user_id and m.deleted_at is null)
$$;
revoke all on function app.read_workspace_write_epoch(uuid, uuid) from public;
grant execute on function app.read_workspace_write_epoch(uuid, uuid) to authenticated;

create function app.assert_workspace_write_epoch(p_workspace_id uuid)
returns void language plpgsql volatile security definer
set search_path = pg_catalog, app
as $$
declare
  state app.workspace_write_epochs;
  claims jsonb := coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb;
  expected text;
  integration_issued_at text;
begin
  -- Same key as the privileged restore helper; the lock lasts through commit.
  -- Normal API transactions acquire this before row locks. A direct RPC or
  -- integration may reach the row trigger first: never wait there while holding
  -- a row that the exclusive restore needs, or it could deadlock the restore.
  if not pg_try_advisory_xact_lock_shared(hashtextextended(p_workspace_id::text, 7334202607)) then
    raise exception 'workspace_restored' using errcode = 'P4009';
  end if;
  if current_setting('transaction_isolation') <> 'read committed' then
    raise exception 'Workspace writes require a fresh snapshot' using errcode = '40001';
  end if;
  select * into state from app.workspace_write_epochs where workspace_id = p_workspace_id;
  if not found then return; end if;
  expected := claims->'planner_write_epochs'->>p_workspace_id::text;
  if expected = state.epoch::text then return; end if;
  -- Integrations bind intent to a verified credential's issuance. Old tokens
  -- cannot be relabelled as current simply because their request arrived late.
  integration_issued_at := claims->>'planner_integration_issued_at';
  if expected is null and integration_issued_at is not null
    and integration_issued_at::timestamptz > state.restored_at then return; end if;
  raise exception 'workspace_restored' using errcode = 'P4009';
end;
$$;
revoke all on function app.assert_workspace_write_epoch(uuid) from public;
grant execute on function app.assert_workspace_write_epoch(uuid) to authenticated;

create function app.guard_workspace_write_epoch()
returns trigger language plpgsql security invoker
set search_path = pg_catalog, app
as $$
declare
  row_data jsonb;
  target_workspace uuid;
begin
  -- Owner maintenance/restore uses no request claims. SECURITY DEFINER domain
  -- functions with user claims still go through the guard.
  if nullif(coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb->>'sub', '') is null and (
    pg_has_role(current_user, (select relowner from pg_class where oid = TG_RELID), 'USAGE')
    or exists (select 1 from pg_roles where rolname = current_user and (rolsuper or rolbypassrls))
  ) then
    if TG_OP = 'DELETE' then return old; else return new; end if;
  end if;
  for row_data in select value from jsonb_array_elements(
    case TG_OP when 'DELETE' then jsonb_build_array(to_jsonb(old))
      when 'UPDATE' then jsonb_build_array(to_jsonb(old), to_jsonb(new))
      else jsonb_build_array(to_jsonb(new)) end) loop
  if TG_TABLE_NAME = 'workspaces' then
    target_workspace := (row_data->>'id')::uuid;
  elsif row_data ? 'workspace_id' then
    target_workspace := (row_data->>'workspace_id')::uuid;
  elsif TG_TABLE_NAME = 'cleaning_task_states' then
    select workspace_id into target_workspace from app.cleaning_tasks where id = (row_data->>'task_id')::uuid;
  elsif row_data ? 'item_id' then
    select workspace_id into target_workspace from app.self_care_items where id = (row_data->>'item_id')::uuid;
  elsif TG_TABLE_NAME = 'self_care_ritual_step_completions' then
    select i.workspace_id into target_workspace from app.self_care_completions c
      join app.self_care_items i on i.id = c.item_id where c.id = (row_data->>'completion_id')::uuid;
  end if;
  if target_workspace is not null then
    perform app.assert_workspace_write_epoch(target_workspace);
  elsif row_data ? 'user_id' or TG_TABLE_NAME = 'users' then
    for target_workspace in select id from app.workspaces
      where owner_user_id = coalesce((row_data->>'user_id')::uuid, (row_data->>'id')::uuid)
        and kind = 'personal' and deleted_at is null order by id
    loop
      perform app.assert_workspace_write_epoch(target_workspace);
    end loop;
  end if;
  end loop;
  if TG_OP = 'DELETE' then return old; else return new; end if;
end;
$$;

do $$ declare name text; begin
  foreach name in array array[
    'workspaces','projects','task_templates','task_chains','tasks','task_time_blocks',
    'task_occurrences','task_attachments','daily_plans','chaos_inbox_items',
    'cleaning_zones','cleaning_tasks','cleaning_task_states','cleaning_task_history',
    'cleaning_operations','habits','habit_entries','self_care_items',
    'self_care_item_alternatives','self_care_schedule_rules','self_care_ritual_steps',
    'self_care_occurrences','self_care_completions','self_care_ritual_step_completions',
    'self_care_ritual_step_drafts','self_care_procedure_details','self_care_appointment_details',
    'self_care_medical_details','self_care_course_details','self_care_measurement_details',
    'self_care_exercise_details','self_care_daily_states','self_care_settings','self_care_minimum_items',
    'self_care_command_ledger'
  ] loop
    execute format('create trigger guard_workspace_epoch before insert or update or delete on app.%I for each row execute function app.guard_workspace_write_epoch()', name);
  end loop;
end $$;
create trigger guard_profile_workspace_epoch before update of display_name, avatar_url,
  timezone, locale, default_time_zone, last_seen_time_zone, time_zone_mode,
  calendar_view_mode, energy_mode on app.users
  for each row execute function app.guard_workspace_write_epoch();

revoke all on function app.guard_workspace_write_epoch() from public;

-- Credentials cannot be issued in the middle of a restore and then carry a
-- pre-restore request past it. Their insert takes the same shared lock. Fail
-- fast when restore owns it, avoiding lock-order inversions with auth rows.
create function app.lock_workspace_credential_issuance()
returns trigger language plpgsql security definer
set search_path = pg_catalog, app
as $$
declare target_workspace uuid;
begin
  for target_workspace in
    select id from app.workspaces where deleted_at is null and (
      (TG_TABLE_NAME = 'api_keys' and id = (to_jsonb(new)->>'workspace_id')::uuid)
      or (TG_TABLE_NAME <> 'api_keys' and owner_user_id = new.user_id and kind = 'personal')
    ) order by id
  loop
    if not pg_try_advisory_xact_lock_shared(hashtextextended(target_workspace::text, 7334202607)) then
      raise exception 'workspace_restored' using errcode = 'P4009';
    end if;
  end loop;
  return new;
end;
$$;
revoke all on function app.lock_workspace_credential_issuance() from public;
create trigger lock_credential_issuance before insert on app.api_keys
  for each row execute function app.lock_workspace_credential_issuance();
create trigger lock_credential_issuance before insert on app.auth_refresh_tokens
  for each row execute function app.lock_workspace_credential_issuance();
create trigger lock_credential_issuance before insert on app.mcp_oauth_tokens
  for each row execute function app.lock_workspace_credential_issuance();
