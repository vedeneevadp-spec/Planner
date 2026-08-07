-- Safe replay protocol for self-care commands created while a client is offline.

alter table app.self_care_completions
  add column if not exists updated_at timestamptz not null default now(),
  add column if not exists version bigint not null default 1;

alter table app.self_care_daily_states
  add column if not exists version bigint not null default 1;

alter table app.self_care_settings
  add column if not exists version bigint not null default 1;

alter table app.self_care_minimum_items
  add column if not exists version bigint not null default 1;

alter table app.self_care_ritual_step_drafts
  add column if not exists version bigint not null default 1;

do $$
declare
  table_name text;
begin
  foreach table_name in array array[
    'self_care_completions',
    'self_care_daily_states',
    'self_care_settings',
    'self_care_minimum_items',
    'self_care_ritual_step_drafts'
  ] loop
    execute format(
      'drop trigger if exists %I on app.%I',
      table_name || '_bump_row_version',
      table_name
    );
    execute format(
      'create trigger %I before update on app.%I for each row execute function app.bump_row_version()',
      table_name || '_bump_row_version',
      table_name
    );
  end loop;
end
$$;

create table if not exists app.self_care_command_ledger (
  workspace_id uuid not null references app.workspaces(id) on delete cascade,
  actor_user_id uuid not null references app.users(id) on delete cascade,
  operation_id uuid not null,
  request_fingerprint text not null,
  response jsonb not null,
  created_at timestamptz not null default now(),
  constraint self_care_command_ledger_fingerprint_sha256
    check (request_fingerprint ~ '^[0-9a-f]{64}$'),
  constraint self_care_command_ledger_scope_operation
    primary key (workspace_id, actor_user_id, operation_id)
);

create index if not exists self_care_command_ledger_created_idx
  on app.self_care_command_ledger (created_at);

create index if not exists self_care_command_ledger_actor_created_idx
  on app.self_care_command_ledger (actor_user_id, created_at desc);

revoke all privileges on table app.self_care_command_ledger
from authenticated;

revoke all privileges on table app.self_care_command_ledger
from public;

comment on table app.self_care_command_ledger is
  'Internal idempotency receipts for atomic self-care command replay. Responses are scoped by workspace and actor.';

-- A step completion is only valid when the step and the completion belong to
-- the same self-care item. The original policy checked only the completion
-- owner, which allowed a guessed step UUID from another item to be linked.
drop policy if exists self_care_ritual_step_completions_private
on app.self_care_ritual_step_completions;

create policy self_care_ritual_step_completions_private
on app.self_care_ritual_step_completions
for all
to authenticated
using (
  exists (
    select 1
    from app.self_care_completions completion
    join app.self_care_ritual_steps step
      on step.id = self_care_ritual_step_completions.step_id
     and step.item_id = completion.item_id
    join app.self_care_items item
      on item.id = completion.item_id
    where completion.id = self_care_ritual_step_completions.completion_id
      and completion.user_id = (select app.current_user_id())
      and item.user_id = (select app.current_user_id())
  )
)
with check (
  exists (
    select 1
    from app.self_care_completions completion
    join app.self_care_ritual_steps step
      on step.id = self_care_ritual_step_completions.step_id
     and step.item_id = completion.item_id
    join app.self_care_items item
      on item.id = completion.item_id
    where completion.id = self_care_ritual_step_completions.completion_id
      and completion.user_id = (select app.current_user_id())
      and item.user_id = (select app.current_user_id())
  )
);

create or replace function app.lock_self_care_command_operation(
  target_workspace_id uuid,
  target_actor_user_id uuid,
  target_operation_id uuid
)
returns void
language plpgsql
security definer
set search_path = pg_catalog, app
as $$
begin
  if app.current_user_id() is not null
    and app.current_user_id() <> target_actor_user_id then
    raise exception 'Self-care command actor mismatch.'
      using errcode = '42501';
  end if;

  if not exists (
    select 1
    from app.workspaces workspace
    where workspace.id = target_workspace_id
      and workspace.owner_user_id = target_actor_user_id
      and workspace.kind = 'personal'
      and workspace.deleted_at is null
  ) then
    raise exception 'Self-care command workspace is unavailable.'
      using errcode = '42501';
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended(
      target_workspace_id::text || ':' ||
      target_actor_user_id::text || ':' ||
      target_operation_id::text,
      8_062_026
    )
  );
end;
$$;

create or replace function app.read_self_care_command_receipt(
  target_workspace_id uuid,
  target_actor_user_id uuid,
  target_operation_id uuid
)
returns table (request_fingerprint text, response jsonb)
language plpgsql
security definer
set search_path = pg_catalog, app
as $$
begin
  if app.current_user_id() is not null
    and app.current_user_id() <> target_actor_user_id then
    raise exception 'Self-care command actor mismatch.'
      using errcode = '42501';
  end if;

  if not exists (
    select 1
    from app.workspaces workspace
    where workspace.id = target_workspace_id
      and workspace.owner_user_id = target_actor_user_id
      and workspace.kind = 'personal'
      and workspace.deleted_at is null
  ) then
    raise exception 'Self-care command workspace is unavailable.'
      using errcode = '42501';
  end if;

  return query
  select ledger.request_fingerprint, ledger.response
  from app.self_care_command_ledger ledger
  where ledger.workspace_id = target_workspace_id
    and ledger.actor_user_id = target_actor_user_id
    and ledger.operation_id = target_operation_id
  limit 1;
end;
$$;

create or replace function app.record_self_care_command_receipt(
  target_workspace_id uuid,
  target_actor_user_id uuid,
  target_operation_id uuid,
  target_request_fingerprint text,
  target_response jsonb
)
returns void
language plpgsql
security definer
set search_path = pg_catalog, app
as $$
begin
  if app.current_user_id() is not null
    and app.current_user_id() <> target_actor_user_id then
    raise exception 'Self-care command actor mismatch.'
      using errcode = '42501';
  end if;

  if not exists (
    select 1
    from app.workspaces workspace
    where workspace.id = target_workspace_id
      and workspace.owner_user_id = target_actor_user_id
      and workspace.kind = 'personal'
      and workspace.deleted_at is null
  ) then
    raise exception 'Self-care command workspace is unavailable.'
      using errcode = '42501';
  end if;

  if target_request_fingerprint !~ '^[0-9a-f]{64}$'
    or target_response is null then
    raise exception 'Invalid self-care command receipt.'
      using errcode = '22023';
  end if;

  insert into app.self_care_command_ledger (
    workspace_id,
    actor_user_id,
    operation_id,
    request_fingerprint,
    response
  ) values (
    target_workspace_id,
    target_actor_user_id,
    target_operation_id,
    target_request_fingerprint,
    target_response
  );
end;
$$;

revoke all on function app.lock_self_care_command_operation(uuid, uuid, uuid)
from public;
revoke all on function app.read_self_care_command_receipt(uuid, uuid, uuid)
from public;
revoke all on function app.record_self_care_command_receipt(uuid, uuid, uuid, text, jsonb)
from public;

grant execute on function app.lock_self_care_command_operation(uuid, uuid, uuid)
to authenticated;
grant execute on function app.read_self_care_command_receipt(uuid, uuid, uuid)
to authenticated;
grant execute on function app.record_self_care_command_receipt(uuid, uuid, uuid, text, jsonb)
to authenticated;
