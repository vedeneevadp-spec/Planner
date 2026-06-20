-- noinspection SqlNoDataSourceInspection
revoke select, insert, update, delete on table
  app.device_sessions,
  app.outbox,
  app.schema_migrations,
  app.sync_cursors
from authenticated;

grant select, insert, update, delete on table app.workspace_invitations to authenticated;
grant select, insert, update on table app.workspace_members to authenticated;

create or replace function app.workspace_can_manage_participants(
  target_workspace_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = app, public
as $$
  select exists (
    select 1
    from app.workspace_members as membership
    where membership.workspace_id = target_workspace_id
      and membership.user_id = (select app.current_user_id())
      and membership.deleted_at is null
      and (
        membership.role = 'owner'::app.workspace_role
        or membership.group_role = 'group_admin'::app.workspace_group_role
      )
  )
$$;

grant execute on function app.workspace_can_manage_participants(uuid) to authenticated;

alter table app.workspace_invitations enable row level security;

drop policy if exists workspace_members_select_self on app.workspace_members;
create policy workspace_members_select_self_or_managed
on app.workspace_members
for select
to authenticated
using (
  user_id = (select app.current_user_id())
  or (select app.workspace_can_manage_participants(workspace_id))
);

drop policy if exists workspace_members_insert_invited_self on app.workspace_members;
create policy workspace_members_insert_invited_self
on app.workspace_members
for insert
to authenticated
with check (
  user_id = (select app.current_user_id())
  and role = 'user'::app.workspace_role
  and exists (
    select 1
    from app.workspace_invitations as invitation
    inner join app.users as actor
      on actor.email = invitation.email
    where invitation.workspace_id = app.workspace_members.workspace_id
      and actor.id = (select app.current_user_id())
      and actor.deleted_at is null
      and invitation.accepted_at is null
      and invitation.declined_at is null
      and invitation.deleted_at is null
  )
);

drop policy if exists workspace_members_update_manage_or_invited_self on app.workspace_members;
create policy workspace_members_update_manage_or_invited_self
on app.workspace_members
for update
to authenticated
using (
  (select app.workspace_can_manage_participants(workspace_id))
  or (
    user_id = (select app.current_user_id())
    and exists (
      select 1
      from app.workspace_invitations as invitation
      inner join app.users as actor
        on actor.email = invitation.email
      where invitation.workspace_id = app.workspace_members.workspace_id
        and actor.id = (select app.current_user_id())
        and actor.deleted_at is null
        and invitation.accepted_at is null
        and invitation.declined_at is null
        and invitation.deleted_at is null
    )
  )
)
with check (
  (select app.workspace_can_manage_participants(workspace_id))
  or user_id = (select app.current_user_id())
);

drop policy if exists users_select_self on app.users;
create policy users_select_self_or_managed_workspace_member
on app.users
for select
to authenticated
using (
  id = (select app.current_user_id())
  or exists (
    select 1
    from app.workspace_members as membership
    where membership.user_id = app.users.id
      and membership.deleted_at is null
      and (select app.workspace_can_manage_participants(membership.workspace_id))
  )
);

drop policy if exists workspaces_select_invited_email on app.workspaces;
create policy workspaces_select_invited_email
on app.workspaces
for select
to authenticated
using (
  deleted_at is null
  and exists (
    select 1
    from app.workspace_invitations as invitation
    inner join app.users as actor
      on actor.email = invitation.email
    where invitation.workspace_id = app.workspaces.id
      and actor.id = (select app.current_user_id())
      and actor.deleted_at is null
      and invitation.accepted_at is null
      and invitation.declined_at is null
      and invitation.deleted_at is null
  )
);

drop policy if exists workspace_invitations_select_manage_or_recipient on app.workspace_invitations;
create policy workspace_invitations_select_manage_or_recipient
on app.workspace_invitations
for select
to authenticated
using (
  (
    deleted_at is null
    and (select app.workspace_can_manage_participants(workspace_id))
  )
  or exists (
    select 1
    from app.users as actor
    where actor.id = (select app.current_user_id())
      and actor.email = app.workspace_invitations.email
      and actor.deleted_at is null
      and app.workspace_invitations.accepted_at is null
      and app.workspace_invitations.declined_at is null
      and app.workspace_invitations.deleted_at is null
  )
);

drop policy if exists workspace_invitations_insert_manage on app.workspace_invitations;
create policy workspace_invitations_insert_manage
on app.workspace_invitations
for insert
to authenticated
with check (
  invited_by = (select app.current_user_id())
  and accepted_by is null
  and accepted_at is null
  and declined_by is null
  and declined_at is null
  and deleted_at is null
  and (select app.workspace_can_manage_participants(workspace_id))
);

drop policy if exists workspace_invitations_update_manage_or_recipient on app.workspace_invitations;
create policy workspace_invitations_update_manage_or_recipient
on app.workspace_invitations
for update
to authenticated
using (
  (select app.workspace_can_manage_participants(workspace_id))
  or exists (
    select 1
    from app.users as actor
    where actor.id = (select app.current_user_id())
      and actor.email = app.workspace_invitations.email
      and actor.deleted_at is null
      and app.workspace_invitations.accepted_at is null
      and app.workspace_invitations.declined_at is null
      and app.workspace_invitations.deleted_at is null
  )
)
with check (
  (select app.workspace_can_manage_participants(workspace_id))
  or exists (
    select 1
    from app.users as actor
    where actor.id = (select app.current_user_id())
      and actor.email = app.workspace_invitations.email
      and actor.deleted_at is null
      and (
        app.workspace_invitations.accepted_by = (select app.current_user_id())
        or app.workspace_invitations.declined_by = (select app.current_user_id())
      )
  )
);

drop policy if exists workspace_invitations_delete_manage on app.workspace_invitations;
create policy workspace_invitations_delete_manage
on app.workspace_invitations
for delete
to authenticated
using (
  (select app.workspace_can_manage_participants(workspace_id))
);
