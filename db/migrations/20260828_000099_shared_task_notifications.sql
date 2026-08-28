-- Account-level notification preferences are enabled by default so existing
-- users keep receiving the new shared-workspace notifications after rollout.
alter table app.users
  add column if not exists shared_task_created_notifications_enabled boolean not null default true,
  add column if not exists shared_task_assigned_notifications_enabled boolean not null default true,
  add column if not exists shared_task_ready_for_review_notifications_enabled boolean not null default true;

grant update (
  shared_task_created_notifications_enabled,
  shared_task_assigned_notifications_enabled,
  shared_task_ready_for_review_notifications_enabled
) on table app.users to authenticated;

-- A native installation belongs to an account, not to the last workspace that
-- happened to be selected when the Firebase token was registered. Keep the
-- legacy workspace column as response metadata for installed clients, but no
-- longer use it for lookup or authorization.
drop policy if exists push_devices_select_self on app.push_devices;
drop policy if exists push_devices_insert_self on app.push_devices;
drop policy if exists push_devices_update_self on app.push_devices;
drop policy if exists push_devices_delete_self on app.push_devices;

drop index if exists app.push_devices_user_idx;
drop index if exists app.push_devices_workspace_idx;

create index if not exists push_devices_user_idx
  on app.push_devices (user_id, last_registered_at desc)
  where deleted_at is null;

create policy push_devices_select_self
on app.push_devices
for select
to authenticated
using (
  (select app.current_user_id()) = user_id
  and deleted_at is null
);

create policy push_devices_insert_self
on app.push_devices
for insert
to authenticated
with check ((select app.current_user_id()) = user_id);

create policy push_devices_update_self
on app.push_devices
for update
to authenticated
using ((select app.current_user_id()) = user_id)
with check ((select app.current_user_id()) = user_id);

create policy push_devices_delete_self
on app.push_devices
for delete
to authenticated
using ((select app.current_user_id()) = user_id);

create or replace function app.claim_push_device_registration(
  target_platform app.push_platform,
  target_installation_id text,
  target_token text
)
returns void
language plpgsql
security definer
set search_path = app, pg_catalog, pg_temp
as $$
declare
  actor_user_id uuid := app.current_user_id();
begin
  if actor_user_id is null then
    raise exception 'Authenticated user is required.'
      using errcode = '42501';
  end if;

  if nullif(btrim(target_installation_id), '') is null
    or nullif(btrim(target_token), '') is null
  then
    raise exception 'Push installation id and token are required.'
      using errcode = '22023';
  end if;

  delete from app.push_devices
  where platform = target_platform
    and user_id <> actor_user_id
    and (
      installation_id = target_installation_id
      or token = target_token
    );
end;
$$;

revoke all on function app.claim_push_device_registration(
  app.push_platform,
  text,
  text
) from public;
grant execute on function app.claim_push_device_registration(
  app.push_platform,
  text,
  text
) to authenticated;

do $$
begin
  if not exists (
    select 1
    from pg_type as enum_type
    inner join pg_namespace as enum_namespace
      on enum_namespace.oid = enum_type.typnamespace
    where enum_namespace.nspname = 'app'
      and enum_type.typname = 'shared_task_notification_kind'
  ) then
    create type app.shared_task_notification_kind as enum (
      'shared_task_created',
      'shared_task_assigned',
      'shared_task_ready_for_review'
    );
  end if;
end;
$$;

create table if not exists app.shared_task_notifications (
  id uuid primary key default gen_random_uuid(),
  source_event_id uuid not null references app.task_events(event_id) on delete cascade,
  kind app.shared_task_notification_kind not null,
  workspace_id uuid not null references app.workspaces(id) on delete cascade,
  task_id uuid not null references app.tasks(id) on delete cascade,
  recipient_user_id uuid not null references app.users(id) on delete cascade,
  actor_user_id uuid references app.users(id) on delete set null,
  available_at timestamptz not null default now(),
  claimed_at timestamptz,
  sent_at timestamptz,
  canceled_at timestamptz,
  failed_at timestamptz,
  attempt_count integer not null default 0,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  version bigint not null default 1,
  constraint shared_task_notifications_source_recipient_unique
    unique (source_event_id, recipient_user_id),
  constraint shared_task_notifications_attempt_count_check
    check (attempt_count >= 0)
);

create index if not exists shared_task_notifications_pending_idx
  on app.shared_task_notifications (available_at, created_at)
  where sent_at is null
    and canceled_at is null
    and failed_at is null;

create index if not exists shared_task_notifications_recipient_idx
  on app.shared_task_notifications (recipient_user_id, created_at desc);

drop trigger if exists shared_task_notifications_bump_row_version
  on app.shared_task_notifications;
create trigger shared_task_notifications_bump_row_version
before update on app.shared_task_notifications
for each row execute function app.bump_row_version();

revoke all privileges on table app.shared_task_notifications from public;
revoke all privileges on table app.shared_task_notifications from authenticated;

create or replace function app.enqueue_shared_task_notifications()
returns trigger
language plpgsql
security definer
set search_path = app, pg_catalog, pg_temp
as $$
declare
  task_row record;
begin
  if new.task_id is null or new.actor_user_id is null then
    return new;
  end if;

  select
    task.assignee_user_id,
    task.created_by,
    task.deleted_at as task_deleted_at,
    workspace.deleted_at as workspace_deleted_at,
    workspace.kind as workspace_kind
  into task_row
  from app.tasks as task
  inner join app.workspaces as workspace
    on workspace.id = task.workspace_id
  where task.id = new.task_id
    and task.workspace_id = new.workspace_id;

  if not found
    or task_row.workspace_kind <> 'shared'::app.workspace_kind
    or task_row.task_deleted_at is not null
    or task_row.workspace_deleted_at is not null
  then
    return new;
  end if;

  if new.event_type::text = 'task.created' then
    if coalesce(new.payload ->> 'origin', 'manual') = 'recurrence' then
      return new;
    end if;

    insert into app.shared_task_notifications (
      actor_user_id,
      kind,
      recipient_user_id,
      source_event_id,
      task_id,
      workspace_id
    )
    select
      new.actor_user_id,
      case
        when member.user_id = task_row.assignee_user_id
          and recipient.shared_task_assigned_notifications_enabled
        then 'shared_task_assigned'::app.shared_task_notification_kind
        else 'shared_task_created'::app.shared_task_notification_kind
      end,
      member.user_id,
      new.event_id,
      new.task_id,
      new.workspace_id
    from app.workspace_members as member
    inner join app.users as recipient
      on recipient.id = member.user_id
      and recipient.deleted_at is null
    where member.workspace_id = new.workspace_id
      and member.deleted_at is null
      and member.user_id is distinct from task_row.created_by
      and member.user_id is distinct from new.actor_user_id
      and (
        (
          member.user_id = task_row.assignee_user_id
          and recipient.shared_task_assigned_notifications_enabled
        )
        or recipient.shared_task_created_notifications_enabled
      )
    on conflict (source_event_id, recipient_user_id) do nothing;

    return new;
  end if;

  if new.event_type::text = 'task.status_changed'
    and new.payload ->> 'status' = 'ready_for_review'
    and new.payload ? 'previousStatus'
    and new.payload ->> 'previousStatus' <> 'ready_for_review'
    and task_row.created_by is distinct from new.actor_user_id
  then
    insert into app.shared_task_notifications (
      actor_user_id,
      kind,
      recipient_user_id,
      source_event_id,
      task_id,
      workspace_id
    )
    select
      new.actor_user_id,
      'shared_task_ready_for_review'::app.shared_task_notification_kind,
      recipient.id,
      new.event_id,
      new.task_id,
      new.workspace_id
    from app.users as recipient
    inner join app.workspace_members as member
      on member.user_id = recipient.id
      and member.workspace_id = new.workspace_id
      and member.deleted_at is null
    where recipient.id = task_row.created_by
      and recipient.deleted_at is null
      and recipient.shared_task_ready_for_review_notifications_enabled
    on conflict (source_event_id, recipient_user_id) do nothing;
  end if;

  return new;
end;
$$;

revoke all on function app.enqueue_shared_task_notifications() from public;
revoke all on function app.enqueue_shared_task_notifications() from authenticated;

drop trigger if exists task_events_enqueue_shared_task_notifications
  on app.task_events;
create trigger task_events_enqueue_shared_task_notifications
after insert on app.task_events
for each row execute function app.enqueue_shared_task_notifications();
