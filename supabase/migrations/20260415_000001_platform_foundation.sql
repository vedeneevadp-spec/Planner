-- noinspection SqlNoDataSourceInspection
create schema if not exists app;

create extension if not exists pgcrypto;
create extension if not exists citext;
create extension if not exists pg_trgm;

create type app.workspace_role as enum ('owner', 'admin', 'member', 'viewer');
create type app.project_status as enum ('active', 'archived');
create type app.task_status as enum ('todo', 'done');
create type app.task_event_type as enum (
  'task.created',
  'task.updated',
  'task.status_changed',
  'task.deleted',
  'task.time_block_added',
  'task.time_block_updated',
  'task.time_block_deleted'
);
create type app.outbox_status as enum (
  'pending',
  'processing',
  'completed',
  'failed'
);

create or replace function app.bump_row_version()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  new.version = old.version + 1;
  return new;
end;
$$;

create table app.users (
  id uuid primary key default gen_random_uuid(),
  email citext not null unique,
  display_name text not null,
  avatar_url text,
  timezone text not null default 'UTC',
  locale text not null default 'en-US',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  version bigint not null default 1
);

create table app.workspaces (
  id uuid primary key default gen_random_uuid(),
  owner_user_id uuid not null references app.users(id),
  name text not null,
  slug text not null unique,
  description text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  version bigint not null default 1
);

create table app.workspace_members (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references app.workspaces(id) on delete cascade,
  user_id uuid not null references app.users(id) on delete cascade,
  role app.workspace_role not null,
  invited_by uuid references app.users(id),
  joined_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  version bigint not null default 1,
  unique (workspace_id, user_id)
);

create table app.projects (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references app.workspaces(id) on delete cascade,
  title text not null,
  slug text not null,
  color text,
  status app.project_status not null default 'active',
  position integer not null default 0,
  metadata jsonb not null default '{}'::jsonb,
  created_by uuid references app.users(id),
  updated_by uuid references app.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  version bigint not null default 1,
  unique (workspace_id, slug)
);

create table app.tasks (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references app.workspaces(id) on delete cascade,
  project_id uuid references app.projects(id) on delete set null,
  parent_task_id uuid references app.tasks(id) on delete set null,
  title text not null,
  description text not null default '',
  status app.task_status not null default 'todo',
  priority smallint not null default 2,
  planned_on date,
  due_on date,
  due_at timestamptz,
  completed_at timestamptz,
  sort_key text not null default '',
  metadata jsonb not null default '{}'::jsonb,
  created_by uuid references app.users(id),
  updated_by uuid references app.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  version bigint not null default 1
);

create table app.task_time_blocks (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references app.workspaces(id) on delete cascade,
  task_id uuid not null references app.tasks(id) on delete cascade,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  timezone text not null,
  source text not null default 'manual',
  position integer not null default 0,
  metadata jsonb not null default '{}'::jsonb,
  created_by uuid references app.users(id),
  updated_by uuid references app.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  version bigint not null default 1,
  constraint task_time_blocks_valid_range check (ends_at > starts_at)
);

create table app.device_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references app.users(id) on delete cascade,
  workspace_id uuid not null references app.workspaces(id) on delete cascade,
  device_fingerprint text not null,
  last_seen_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  version bigint not null default 1,
  unique (user_id, workspace_id, device_fingerprint)
);

create table app.task_events (
  id bigint generated always as identity primary key,
  event_id uuid not null default gen_random_uuid() unique,
  workspace_id uuid not null references app.workspaces(id) on delete cascade,
  task_id uuid references app.tasks(id) on delete cascade,
  actor_user_id uuid references app.users(id),
  event_type app.task_event_type not null,
  payload jsonb not null default '{}'::jsonb,
  occurred_at timestamptz not null default now()
);

create table app.sync_cursors (
  id uuid primary key default gen_random_uuid(),
  device_session_id uuid not null references app.device_sessions(id) on delete cascade,
  stream text not null,
  last_event_id bigint not null default 0,
  updated_at timestamptz not null default now(),
  unique (device_session_id, stream)
);

create table app.outbox (
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

create index task_projects_workspace_idx
  on app.projects (workspace_id, position);

create index task_items_workspace_idx
  on app.tasks (workspace_id, status, planned_on, due_on, due_at);

create index task_items_project_idx
  on app.tasks (project_id)
  where project_id is not null;

create index task_items_search_idx
  on app.tasks
  using gin (
    to_tsvector(
      'simple',
      trim(both ' ' from coalesce(title, '') || ' ' || coalesce(description, ''))
    )
  );

create index task_time_blocks_task_idx
  on app.task_time_blocks (task_id, starts_at);

create index task_events_workspace_idx
  on app.task_events (workspace_id, id);

create index outbox_pending_idx
  on app.outbox (status, available_at)
  where status in ('pending', 'failed');

create trigger users_bump_row_version
before update on app.users
for each row execute function app.bump_row_version();

create trigger workspaces_bump_row_version
before update on app.workspaces
for each row execute function app.bump_row_version();

create trigger workspace_members_bump_row_version
before update on app.workspace_members
for each row execute function app.bump_row_version();

create trigger projects_bump_row_version
before update on app.projects
for each row execute function app.bump_row_version();

create trigger tasks_bump_row_version
before update on app.tasks
for each row execute function app.bump_row_version();

create trigger task_time_blocks_bump_row_version
before update on app.task_time_blocks
for each row execute function app.bump_row_version();

create trigger device_sessions_bump_row_version
before update on app.device_sessions
for each row execute function app.bump_row_version();
