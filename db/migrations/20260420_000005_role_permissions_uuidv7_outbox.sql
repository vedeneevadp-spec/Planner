-- noinspection SqlNoDataSourceInspection
create extension if not exists pgcrypto;

create or replace function app.uuid_generate_v7()
returns uuid
language plpgsql
volatile
as $$
declare
  random_hex text;
  timestamp_hex text;
  unix_ts_ms bigint;
  variant_hex text;
begin
  unix_ts_ms := floor(extract(epoch from clock_timestamp()) * 1000)::bigint;
  timestamp_hex := right(lpad(to_hex(unix_ts_ms), 12, '0'), 12);
  random_hex := encode(gen_random_bytes(10), 'hex');
  variant_hex := substr('89ab', (get_byte(gen_random_bytes(1), 0) % 4) + 1, 1);

  return (
    substr(timestamp_hex, 1, 8) || '-' ||
    substr(timestamp_hex, 9, 4) || '-' ||
    '7' || substr(random_hex, 1, 3) || '-' ||
    variant_hex || substr(random_hex, 4, 3) || '-' ||
    substr(random_hex, 7, 12)
  )::uuid;
end;
$$;

alter table app.users alter column id set default app.uuid_generate_v7();
alter table app.workspaces alter column id set default app.uuid_generate_v7();
alter table app.workspace_members alter column id set default app.uuid_generate_v7();
alter table app.projects alter column id set default app.uuid_generate_v7();
alter table app.tasks alter column id set default app.uuid_generate_v7();
alter table app.task_time_blocks alter column id set default app.uuid_generate_v7();
alter table app.device_sessions alter column id set default app.uuid_generate_v7();
alter table app.task_events alter column event_id set default app.uuid_generate_v7();

create table if not exists app.task_attachments (
  id uuid primary key default app.uuid_generate_v7(),
  workspace_id uuid not null references app.workspaces(id) on delete cascade,
  task_id uuid not null references app.tasks(id) on delete cascade,
  storage_bucket text not null default 'task-attachments',
  storage_object_path text not null,
  original_filename text not null,
  content_type text not null,
  size_bytes bigint not null default 0,
  metadata jsonb not null default '{}'::jsonb,
  created_by uuid references app.users(id),
  updated_by uuid references app.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  version bigint not null default 1,
  unique (storage_bucket, storage_object_path)
);

create index if not exists task_attachments_workspace_idx
  on app.task_attachments (workspace_id, task_id, created_at);

drop trigger if exists task_attachments_bump_row_version on app.task_attachments;
create trigger task_attachments_bump_row_version
before update on app.task_attachments
for each row execute function app.bump_row_version();

grant select, insert, update, delete on table app.task_attachments to authenticated;
alter table app.task_attachments enable row level security;

create or replace function app.workspace_has_write_access(target_workspace_id uuid)
returns boolean
language sql
stable
as $$
  select exists (
    select 1
    from app.workspace_members as membership
    where membership.workspace_id = target_workspace_id
      and membership.user_id = (select app.current_user_id())
      and membership.role in ('owner', 'admin', 'member')
      and membership.deleted_at is null
  )
$$;

drop policy if exists task_attachments_select_member on app.task_attachments;
create policy task_attachments_select_member
on app.task_attachments
for select
to authenticated
using (
  (select app.workspace_is_accessible(workspace_id))
  and deleted_at is null
);

drop policy if exists task_attachments_insert_member on app.task_attachments;
create policy task_attachments_insert_member
on app.task_attachments
for insert
to authenticated
with check (
  (select app.workspace_has_write_access(workspace_id))
  and created_by = (select app.current_user_id())
  and updated_by = (select app.current_user_id())
);

drop policy if exists task_attachments_update_member on app.task_attachments;
create policy task_attachments_update_member
on app.task_attachments
for update
to authenticated
using (
  (select app.workspace_has_write_access(workspace_id))
)
with check (
  (select app.workspace_has_write_access(workspace_id))
  and updated_by = (select app.current_user_id())
);

drop policy if exists task_attachments_delete_member on app.task_attachments;
create policy task_attachments_delete_member
on app.task_attachments
for delete
to authenticated
using (
  (select app.workspace_has_write_access(workspace_id))
);

drop policy if exists projects_insert_member on app.projects;
create policy projects_insert_member
on app.projects
for insert
to authenticated
with check (
  (select app.workspace_has_write_access(workspace_id))
  and created_by = (select app.current_user_id())
  and updated_by = (select app.current_user_id())
);

drop policy if exists projects_update_member on app.projects;
create policy projects_update_member
on app.projects
for update
to authenticated
using (
  (select app.workspace_has_write_access(workspace_id))
)
with check (
  (select app.workspace_has_write_access(workspace_id))
  and updated_by = (select app.current_user_id())
);

drop policy if exists projects_delete_member on app.projects;
create policy projects_delete_member
on app.projects
for delete
to authenticated
using (
  (select app.workspace_has_write_access(workspace_id))
);

drop policy if exists tasks_insert_member on app.tasks;
create policy tasks_insert_member
on app.tasks
for insert
to authenticated
with check (
  (select app.workspace_has_write_access(workspace_id))
  and created_by = (select app.current_user_id())
  and updated_by = (select app.current_user_id())
);

drop policy if exists tasks_update_member on app.tasks;
create policy tasks_update_member
on app.tasks
for update
to authenticated
using (
  (select app.workspace_has_write_access(workspace_id))
)
with check (
  (select app.workspace_has_write_access(workspace_id))
  and updated_by = (select app.current_user_id())
);

drop policy if exists tasks_delete_member on app.tasks;
create policy tasks_delete_member
on app.tasks
for delete
to authenticated
using (
  (select app.workspace_has_write_access(workspace_id))
);

drop policy if exists task_time_blocks_insert_member on app.task_time_blocks;
create policy task_time_blocks_insert_member
on app.task_time_blocks
for insert
to authenticated
with check (
  (select app.workspace_has_write_access(workspace_id))
  and created_by = (select app.current_user_id())
  and updated_by = (select app.current_user_id())
);

drop policy if exists task_time_blocks_update_member on app.task_time_blocks;
create policy task_time_blocks_update_member
on app.task_time_blocks
for update
to authenticated
using (
  (select app.workspace_has_write_access(workspace_id))
)
with check (
  (select app.workspace_has_write_access(workspace_id))
  and updated_by = (select app.current_user_id())
);

drop policy if exists task_time_blocks_delete_member on app.task_time_blocks;
create policy task_time_blocks_delete_member
on app.task_time_blocks
for delete
to authenticated
using (
  (select app.workspace_has_write_access(workspace_id))
);

drop policy if exists task_events_insert_member on app.task_events;
create policy task_events_insert_member
on app.task_events
for insert
to authenticated
with check (
  (select app.workspace_has_write_access(workspace_id))
  and actor_user_id = (select app.current_user_id())
);

create or replace function app.enqueue_task_event_outbox()
returns trigger
language plpgsql
security definer
set search_path = app, public
as $$
declare
  event_payload jsonb;
begin
  event_payload := jsonb_build_object(
    'actorUserId', new.actor_user_id,
    'eventId', new.event_id,
    'eventType', new.event_type::text,
    'payload', new.payload,
    'taskId', new.task_id,
    'workspaceId', new.workspace_id
  );

  insert into app.outbox (
    aggregate_type,
    aggregate_id,
    topic,
    payload
  )
  values (
    'task',
    coalesce(new.task_id, new.event_id),
    new.event_type::text,
    event_payload
  );

  if to_regnamespace('pgmq') is not null then
    begin
      execute 'select pgmq.send($1, $2)'
      using 'planner_task_events', event_payload;
    exception
      when undefined_function or undefined_table or invalid_schema_name then null;
    end;
  end if;

  return new;
end;
$$;

drop trigger if exists task_events_enqueue_outbox on app.task_events;
create trigger task_events_enqueue_outbox
after insert on app.task_events
for each row execute function app.enqueue_task_event_outbox();

alter table app.task_events replica identity full;

create or replace function app.prune_completed_outbox(
  retention interval default interval '14 days'
)
returns integer
language plpgsql
security definer
set search_path = app, public
as $$
declare
  deleted_count integer;
begin
  delete from app.outbox
  where status = 'completed'
    and processed_at is not null
    and processed_at < now() - retention;

  get diagnostics deleted_count = row_count;

  return deleted_count;
end;
$$;

do $$
declare
  cron_job_exists boolean := false;
begin
  if to_regclass('storage.buckets') is not null then
    execute $storage$
      insert into storage.buckets (
        allowed_mime_types,
        file_size_limit,
        id,
        name,
        public
      )
      values (
        array[
          'application/pdf',
          'image/gif',
          'image/jpeg',
          'image/png',
          'text/plain'
        ],
        52428800,
        'task-attachments',
        'task-attachments',
        false
      )
      on conflict (id) do update
      set
        allowed_mime_types = excluded.allowed_mime_types,
        file_size_limit = excluded.file_size_limit,
        public = excluded.public
    $storage$;
  end if;

  if exists (
    select 1
    from pg_available_extensions
    where name = 'pgmq'
  ) then
    begin
      execute 'create extension if not exists pgmq';
      execute 'select pgmq.create($1)' using 'planner_task_events';
    exception
      when duplicate_object or duplicate_table or insufficient_privilege or invalid_schema_name or undefined_function or unique_violation then null;
    end;
  end if;

  if exists (
    select 1
    from pg_available_extensions
    where name = 'pg_cron'
  ) then
    begin
      execute 'create extension if not exists pg_cron';
    exception
      when insufficient_privilege then null;
    end;
  end if;

  if to_regnamespace('cron') is not null then
    begin
      execute
        'select exists (select 1 from cron.job where jobname = $1)'
        into cron_job_exists
        using 'planner-prune-completed-outbox';

      if not cron_job_exists then
        execute 'select cron.schedule($1, $2, $3)'
        using
          'planner-prune-completed-outbox',
          '17 3 * * *',
          'select app.prune_completed_outbox();';
      end if;
    exception
      when insufficient_privilege or invalid_schema_name or undefined_function or undefined_table then null;
    end;
  end if;
end;
$$;
