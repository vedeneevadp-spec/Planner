-- noinspection SqlNoDataSourceInspection
create table if not exists app.task_templates (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references app.workspaces(id) on delete cascade,
  project_id uuid references app.projects(id) on delete set null,
  title text not null,
  description text not null default '',
  planned_on date,
  planned_start_time time,
  planned_end_time time,
  due_on date,
  metadata jsonb not null default '{}'::jsonb,
  created_by uuid references app.users(id),
  updated_by uuid references app.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  version bigint not null default 1,
  constraint task_templates_valid_time_range check (
    planned_start_time is null
    or planned_end_time is null
    or planned_end_time > planned_start_time
  )
);

create index if not exists task_templates_workspace_idx
  on app.task_templates (workspace_id, title, created_at)
  where deleted_at is null;

create index if not exists task_templates_project_idx
  on app.task_templates (project_id)
  where project_id is not null and deleted_at is null;

drop trigger if exists task_templates_bump_row_version on app.task_templates;
create trigger task_templates_bump_row_version
before update on app.task_templates
for each row execute function app.bump_row_version();

grant select, insert, update, delete on table app.task_templates to authenticated;

alter table app.task_templates enable row level security;

drop policy if exists task_templates_select_member on app.task_templates;
create policy task_templates_select_member
on app.task_templates
for select
to authenticated
using (
  (select app.workspace_is_accessible(workspace_id))
  and deleted_at is null
);

drop policy if exists task_templates_insert_member on app.task_templates;
create policy task_templates_insert_member
on app.task_templates
for insert
to authenticated
with check (
  (select app.workspace_is_accessible(workspace_id))
  and created_by = (select app.current_user_id())
  and updated_by = (select app.current_user_id())
);

drop policy if exists task_templates_update_member on app.task_templates;
create policy task_templates_update_member
on app.task_templates
for update
to authenticated
using (
  (select app.workspace_is_accessible(workspace_id))
)
with check (
  (select app.workspace_is_accessible(workspace_id))
  and updated_by = (select app.current_user_id())
);

drop policy if exists task_templates_delete_member on app.task_templates;
create policy task_templates_delete_member
on app.task_templates
for delete
to authenticated
using (
  (select app.workspace_is_accessible(workspace_id))
);
