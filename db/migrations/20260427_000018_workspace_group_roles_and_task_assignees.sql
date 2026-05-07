-- noinspection SqlNoDataSourceInspection
alter table app.tasks
  add column if not exists assignee_user_id uuid references app.users(id) on delete set null;

create index if not exists tasks_workspace_assignee_idx
  on app.tasks (workspace_id, assignee_user_id)
  where assignee_user_id is not null and deleted_at is null;

alter table app.workspace_invitations
  add column if not exists group_role app.workspace_group_role;

update app.workspace_invitations
set group_role = case role
  when 'admin'::app.workspace_role then 'group_admin'::app.workspace_group_role
  when 'user'::app.workspace_role then 'member'::app.workspace_group_role
  else 'member'::app.workspace_group_role
end
where group_role is null
  and role is not null;

update app.workspace_members as membership
set group_role = case membership.role
  when 'owner'::app.workspace_role then 'group_admin'::app.workspace_group_role
  when 'admin'::app.workspace_role then 'group_admin'::app.workspace_group_role
  when 'user'::app.workspace_role then 'member'::app.workspace_group_role
  else 'member'::app.workspace_group_role
end
from app.workspaces as workspace
where workspace.id = membership.workspace_id
  and workspace.kind = 'shared'
  and membership.deleted_at is null
  and membership.group_role is null;

alter table app.workspace_invitations
  alter column group_role set not null;

alter table app.workspace_invitations
  drop constraint if exists workspace_invitations_role_assignable_check;

alter table app.workspace_invitations
  drop column if exists role;
