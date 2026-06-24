-- noinspection SqlNoDataSourceInspection

create table if not exists app.task_chains (
  id uuid primary key default app.uuid_generate_v7(),
  workspace_id uuid not null references app.workspaces(id) on delete cascade,
  root_task_id uuid references app.tasks(id) on delete set null,
  title text not null default '',
  status text not null default 'active',
  metadata jsonb not null default '{}'::jsonb,
  created_by uuid references app.users(id),
  updated_by uuid references app.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  version bigint not null default 1,
  constraint task_chains_status_check check (
    status in ('active', 'completed', 'archived')
  )
);

alter table app.tasks
  add column if not exists chain_id uuid references app.task_chains(id) on delete set null,
  add column if not exists previous_task_id uuid references app.tasks(id) on delete set null,
  add column if not exists stage_index integer,
  add column if not exists stage_type text,
  add column if not exists completion_type text;

alter table app.tasks
  drop constraint if exists tasks_stage_index_positive,
  drop constraint if exists tasks_stage_type_check,
  drop constraint if exists tasks_completion_type_check;

alter table app.tasks
  add constraint tasks_stage_index_positive
  check (stage_index is null or stage_index > 0),
  add constraint tasks_stage_type_check
  check (
    stage_type is null
    or stage_type in ('task', 'waiting', 'parallel', 'template')
  ),
  add constraint tasks_completion_type_check
  check (
    completion_type is null
    or completion_type in ('completed', 'advanced')
  );

update app.tasks
set completion_type = 'completed'
where status = 'done'
  and completion_type is null;

create index if not exists task_chains_workspace_idx
  on app.task_chains (workspace_id, status, created_at)
  where deleted_at is null;

create index if not exists task_chains_root_task_idx
  on app.task_chains (root_task_id)
  where deleted_at is null;

create index if not exists tasks_workspace_chain_stage_idx
  on app.tasks (workspace_id, chain_id, stage_index, created_at)
  where deleted_at is null
    and chain_id is not null;

create index if not exists tasks_previous_task_idx
  on app.tasks (previous_task_id)
  where deleted_at is null
    and previous_task_id is not null;

drop trigger if exists task_chains_bump_row_version on app.task_chains;
create trigger task_chains_bump_row_version
before update on app.task_chains
for each row execute function app.bump_row_version();

grant select, insert, update, delete on table app.task_chains to authenticated;

alter table app.task_chains enable row level security;

drop policy if exists task_chains_select_member on app.task_chains;
create policy task_chains_select_member
on app.task_chains
for select
to authenticated
using (
  (select app.workspace_is_accessible(workspace_id))
  and deleted_at is null
);

drop policy if exists task_chains_insert_member on app.task_chains;
create policy task_chains_insert_member
on app.task_chains
for insert
to authenticated
with check (
  (select app.workspace_is_accessible(workspace_id))
  and created_by = (select app.current_user_id())
  and updated_by = (select app.current_user_id())
);

drop policy if exists task_chains_update_member on app.task_chains;
create policy task_chains_update_member
on app.task_chains
for update
to authenticated
using (
  (select app.workspace_is_accessible(workspace_id))
)
with check (
  (select app.workspace_is_accessible(workspace_id))
  and updated_by = (select app.current_user_id())
);

drop policy if exists task_chains_delete_member on app.task_chains;
create policy task_chains_delete_member
on app.task_chains
for delete
to authenticated
using (
  (select app.workspace_is_accessible(workspace_id))
);
