-- noinspection SqlNoDataSourceInspection
create schema if not exists app;

 do $$
 begin
   if not exists (
     select 1
     from pg_roles
     where rolname = 'authenticated'
   ) then
     create role authenticated nologin;
   end if;
 end
 $$;

create or replace function app.current_jwt()
returns jsonb
language sql
stable
as $$
  select coalesce(
    nullif(current_setting('request.jwt.claims', true), ''),
    '{}'
  )::jsonb
$$;

create or replace function app.current_user_id()
returns uuid
language sql
stable
as $$
  select nullif(app.current_jwt() ->> 'sub', '')::uuid
$$;

create or replace function app.workspace_is_accessible(target_workspace_id uuid)
returns boolean
language sql
stable
as $$
  select exists (
    select 1
    from app.workspace_members as membership
    where membership.workspace_id = target_workspace_id
      and membership.user_id = (select app.current_user_id())
      and membership.deleted_at is null
  )
$$;

grant usage on schema app to authenticated;
grant usage, select on all sequences in schema app to authenticated;

grant select on table app.users to authenticated;
grant select on table app.workspaces to authenticated;
grant select on table app.workspace_members to authenticated;
grant select, insert, update, delete on table app.projects to authenticated;
grant select, insert, update, delete on table app.tasks to authenticated;
grant select, insert, update, delete on table app.task_time_blocks to authenticated;
grant select, insert on table app.task_events to authenticated;

alter table app.users enable row level security;
alter table app.workspaces enable row level security;
alter table app.workspace_members enable row level security;
alter table app.projects enable row level security;
alter table app.tasks enable row level security;
alter table app.task_time_blocks enable row level security;
alter table app.task_events enable row level security;

drop policy if exists users_select_self on app.users;
create policy users_select_self
on app.users
for select
to authenticated
using (
  (select app.current_user_id()) = id
);

drop policy if exists workspaces_select_member on app.workspaces;
create policy workspaces_select_member
on app.workspaces
for select
to authenticated
using (
  (select app.workspace_is_accessible(id))
);

drop policy if exists workspace_members_select_self on app.workspace_members;
create policy workspace_members_select_self
on app.workspace_members
for select
to authenticated
using (
  (select app.current_user_id()) = user_id
  and deleted_at is null
);

drop policy if exists projects_select_member on app.projects;
create policy projects_select_member
on app.projects
for select
to authenticated
using (
  (select app.workspace_is_accessible(workspace_id))
  and deleted_at is null
);

drop policy if exists projects_insert_member on app.projects;
create policy projects_insert_member
on app.projects
for insert
to authenticated
with check (
  (select app.workspace_is_accessible(workspace_id))
  and created_by = (select app.current_user_id())
  and updated_by = (select app.current_user_id())
);

drop policy if exists projects_update_member on app.projects;
create policy projects_update_member
on app.projects
for update
to authenticated
using (
  (select app.workspace_is_accessible(workspace_id))
)
with check (
  (select app.workspace_is_accessible(workspace_id))
  and updated_by = (select app.current_user_id())
);

drop policy if exists projects_delete_member on app.projects;
create policy projects_delete_member
on app.projects
for delete
to authenticated
using (
  (select app.workspace_is_accessible(workspace_id))
);

drop policy if exists tasks_select_member on app.tasks;
create policy tasks_select_member
on app.tasks
for select
to authenticated
using (
  (select app.workspace_is_accessible(workspace_id))
  and deleted_at is null
);

drop policy if exists tasks_insert_member on app.tasks;
create policy tasks_insert_member
on app.tasks
for insert
to authenticated
with check (
  (select app.workspace_is_accessible(workspace_id))
  and created_by = (select app.current_user_id())
  and updated_by = (select app.current_user_id())
);

drop policy if exists tasks_update_member on app.tasks;
create policy tasks_update_member
on app.tasks
for update
to authenticated
using (
  (select app.workspace_is_accessible(workspace_id))
)
with check (
  (select app.workspace_is_accessible(workspace_id))
  and updated_by = (select app.current_user_id())
);

drop policy if exists tasks_delete_member on app.tasks;
create policy tasks_delete_member
on app.tasks
for delete
to authenticated
using (
  (select app.workspace_is_accessible(workspace_id))
);

drop policy if exists task_time_blocks_select_member on app.task_time_blocks;
create policy task_time_blocks_select_member
on app.task_time_blocks
for select
to authenticated
using (
  (select app.workspace_is_accessible(workspace_id))
  and deleted_at is null
);

drop policy if exists task_time_blocks_insert_member on app.task_time_blocks;
create policy task_time_blocks_insert_member
on app.task_time_blocks
for insert
to authenticated
with check (
  (select app.workspace_is_accessible(workspace_id))
  and created_by = (select app.current_user_id())
  and updated_by = (select app.current_user_id())
);

drop policy if exists task_time_blocks_update_member on app.task_time_blocks;
create policy task_time_blocks_update_member
on app.task_time_blocks
for update
to authenticated
using (
  (select app.workspace_is_accessible(workspace_id))
)
with check (
  (select app.workspace_is_accessible(workspace_id))
  and updated_by = (select app.current_user_id())
);

drop policy if exists task_time_blocks_delete_member on app.task_time_blocks;
create policy task_time_blocks_delete_member
on app.task_time_blocks
for delete
to authenticated
using (
  (select app.workspace_is_accessible(workspace_id))
);

drop policy if exists task_events_select_member on app.task_events;
create policy task_events_select_member
on app.task_events
for select
to authenticated
using (
  (select app.workspace_is_accessible(workspace_id))
);

drop policy if exists task_events_insert_member on app.task_events;
create policy task_events_insert_member
on app.task_events
for insert
to authenticated
with check (
  (select app.workspace_is_accessible(workspace_id))
  and actor_user_id = (select app.current_user_id())
);
