-- noinspection SqlNoDataSourceInspection
create schema if not exists app;

create extension if not exists pgcrypto;

do $$
begin
  create type app.task_event_type as enum (
    'task.created',
    'task.updated',
    'task.status_changed',
    'task.deleted',
    'task.time_block_added',
    'task.time_block_updated',
    'task.time_block_deleted'
  );
exception
  when duplicate_object then null;
end;
$$;

alter type app.task_event_type add value if not exists 'task.created';
alter type app.task_event_type add value if not exists 'task.updated';
alter type app.task_event_type add value if not exists 'task.status_changed';
alter type app.task_event_type add value if not exists 'task.deleted';
alter type app.task_event_type add value if not exists 'task.time_block_added';
alter type app.task_event_type add value if not exists 'task.time_block_updated';
alter type app.task_event_type add value if not exists 'task.time_block_deleted';

do $$
begin
  create type app.outbox_status as enum (
    'pending',
    'processing',
    'completed',
    'failed'
  );
exception
  when duplicate_object then null;
end;
$$;

alter type app.outbox_status add value if not exists 'pending';
alter type app.outbox_status add value if not exists 'processing';
alter type app.outbox_status add value if not exists 'completed';
alter type app.outbox_status add value if not exists 'failed';

create table if not exists app.task_events (
  id bigint generated always as identity primary key,
  event_id uuid not null default gen_random_uuid(),
  workspace_id uuid not null references app.workspaces(id) on delete cascade,
  task_id uuid references app.tasks(id) on delete cascade,
  actor_user_id uuid references app.users(id),
  event_type app.task_event_type not null,
  payload jsonb not null default '{}'::jsonb,
  occurred_at timestamptz not null default now()
);

alter table app.task_events
  add column if not exists event_id uuid not null default gen_random_uuid(),
  add column if not exists workspace_id uuid references app.workspaces(id) on delete cascade,
  add column if not exists task_id uuid references app.tasks(id) on delete cascade,
  add column if not exists actor_user_id uuid references app.users(id),
  add column if not exists event_type app.task_event_type not null default 'task.created',
  add column if not exists payload jsonb not null default '{}'::jsonb,
  add column if not exists occurred_at timestamptz not null default now();

create unique index if not exists task_events_event_id_idx
  on app.task_events (event_id);

create index if not exists task_events_workspace_idx
  on app.task_events (workspace_id, id);

create table if not exists app.outbox (
  id bigint generated always as identity primary key,
  aggregate_type text not null,
  aggregate_id uuid not null,
  topic text not null,
  payload jsonb not null,
  status app.outbox_status not null default 'pending',
  attempts integer not null default 0,
  available_at timestamptz not null default now(),
  locked_at timestamptz,
  processed_at timestamptz,
  last_error text,
  created_at timestamptz not null default now()
);

alter table app.outbox
  add column if not exists aggregate_type text,
  add column if not exists aggregate_id uuid,
  add column if not exists topic text,
  add column if not exists payload jsonb not null default '{}'::jsonb,
  add column if not exists status app.outbox_status not null default 'pending',
  add column if not exists attempts integer not null default 0,
  add column if not exists available_at timestamptz not null default now(),
  add column if not exists locked_at timestamptz,
  add column if not exists processed_at timestamptz,
  add column if not exists last_error text,
  add column if not exists created_at timestamptz not null default now();

create index if not exists outbox_pending_idx
  on app.outbox (status, available_at)
  where status in ('pending', 'failed');
