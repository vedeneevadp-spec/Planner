-- noinspection SqlNoDataSourceInspection

create table if not exists app.cleaning_operations (
  workspace_id uuid not null references app.workspaces(id) on delete cascade,
  actor_user_id uuid not null references app.users(id) on delete cascade,
  operation_id uuid not null,
  operation_type text not null,
  request_fingerprint text not null,
  response jsonb,
  created_at timestamptz not null default now(),
  completed_at timestamptz,
  primary key (workspace_id, actor_user_id, operation_id),
  constraint cleaning_operations_type_not_blank
    check (length(btrim(operation_type)) between 1 and 80),
  constraint cleaning_operations_fingerprint_sha256
    check (request_fingerprint ~ '^[0-9a-f]{64}$'),
  constraint cleaning_operations_completion_consistent
    check (
      (response is null and completed_at is null)
      or (response is not null and completed_at is not null)
    )
);

create index if not exists cleaning_operations_created_at_idx
  on app.cleaning_operations (created_at);

comment on table app.cleaning_operations is
  'Actor and workspace scoped idempotency receipts for cleaning write commands. Retain only for the configured replay window.';

revoke all on table app.cleaning_operations from public, authenticated;

create or replace function app.begin_cleaning_operation(
  input_workspace_id uuid,
  input_actor_user_id uuid,
  input_operation_id uuid,
  input_operation_type text,
  input_request_fingerprint text
)
returns table (
  inserted boolean,
  stored_operation_type text,
  stored_request_fingerprint text,
  stored_response jsonb
)
language plpgsql
security definer
set search_path = pg_catalog, app
as $$
declare
  claims_user_id uuid := app.current_user_id();
  inserted_operation_id uuid;
begin
  if claims_user_id is not null and claims_user_id <> input_actor_user_id then
    raise insufficient_privilege
      using message = 'begin_cleaning_operation requires current JWT subject to match actor user.';
  end if;

  if not exists (
    select 1
    from app.workspaces workspace
    where workspace.id = input_workspace_id
      and workspace.deleted_at is null
      and (
        workspace.owner_user_id = input_actor_user_id
        or exists (
          select 1
          from app.workspace_members membership
          where membership.workspace_id = workspace.id
            and membership.user_id = input_actor_user_id
            and membership.deleted_at is null
            and (
              (workspace.kind = 'personal' and membership.role <> 'guest')
              or (
                workspace.kind = 'shared'
                and membership.group_role in ('group_admin', 'senior_member', 'member')
              )
            )
        )
      )
  ) then
    raise insufficient_privilege
      using message = 'begin_cleaning_operation requires workspace write access.';
  end if;

  insert into app.cleaning_operations (
    workspace_id,
    actor_user_id,
    operation_id,
    operation_type,
    request_fingerprint
  ) values (
    input_workspace_id,
    input_actor_user_id,
    input_operation_id,
    input_operation_type,
    input_request_fingerprint
  )
  on conflict (workspace_id, actor_user_id, operation_id) do nothing
  returning operation_id into inserted_operation_id;

  if inserted_operation_id is not null then
    return query
      select
        true,
        input_operation_type,
        input_request_fingerprint,
        null::jsonb;
    return;
  end if;

  return query
    select
      false,
      operation.operation_type,
      operation.request_fingerprint,
      operation.response
    from app.cleaning_operations operation
    where operation.workspace_id = input_workspace_id
      and operation.actor_user_id = input_actor_user_id
      and operation.operation_id = input_operation_id;
end;
$$;

create or replace function app.complete_cleaning_operation(
  input_workspace_id uuid,
  input_actor_user_id uuid,
  input_operation_id uuid,
  input_operation_type text,
  input_request_fingerprint text,
  input_response jsonb
)
returns boolean
language plpgsql
security definer
set search_path = pg_catalog, app
as $$
declare
  claims_user_id uuid := app.current_user_id();
  updated_count integer := 0;
begin
  if claims_user_id is not null and claims_user_id <> input_actor_user_id then
    raise insufficient_privilege
      using message = 'complete_cleaning_operation requires current JWT subject to match actor user.';
  end if;

  if not exists (
    select 1
    from app.workspaces workspace
    where workspace.id = input_workspace_id
      and workspace.deleted_at is null
      and (
        workspace.owner_user_id = input_actor_user_id
        or exists (
          select 1
          from app.workspace_members membership
          where membership.workspace_id = workspace.id
            and membership.user_id = input_actor_user_id
            and membership.deleted_at is null
            and (
              (workspace.kind = 'personal' and membership.role <> 'guest')
              or (
                workspace.kind = 'shared'
                and membership.group_role in ('group_admin', 'senior_member', 'member')
              )
            )
        )
      )
  ) then
    raise insufficient_privilege
      using message = 'complete_cleaning_operation requires workspace write access.';
  end if;

  update app.cleaning_operations
  set
    response = input_response,
    completed_at = now()
  where workspace_id = input_workspace_id
    and actor_user_id = input_actor_user_id
    and operation_id = input_operation_id
    and operation_type = input_operation_type
    and request_fingerprint = input_request_fingerprint
    and response is null;

  get diagnostics updated_count = row_count;

  return updated_count = 1;
end;
$$;

revoke all on function app.begin_cleaning_operation(uuid, uuid, uuid, text, text)
  from public;
revoke all on function app.complete_cleaning_operation(uuid, uuid, uuid, text, text, jsonb)
  from public;

grant execute on function app.begin_cleaning_operation(uuid, uuid, uuid, text, text)
  to authenticated;
grant execute on function app.complete_cleaning_operation(uuid, uuid, uuid, text, text, jsonb)
  to authenticated;
