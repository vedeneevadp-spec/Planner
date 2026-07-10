-- noinspection SqlNoDataSourceInspection

revoke update (app_role) on table app.users from authenticated;

grant update (
  avatar_url,
  calendar_view_mode,
  default_time_zone,
  display_name,
  energy_mode,
  last_seen_time_zone,
  time_zone_mode,
  voice_assistant_enabled
) on table app.users to authenticated;

create or replace function app.set_user_app_role(
  target_user_id uuid,
  target_role app.app_role
)
returns boolean
language plpgsql
security definer
set search_path = app, pg_temp
as $$
begin
  if (select app.current_user_app_role()) <> 'owner'::app.app_role then
    return false;
  end if;

  if target_role = 'owner'::app.app_role then
    return false;
  end if;

  update app.users
  set app_role = target_role
  where id = target_user_id
    and app_role <> 'owner'::app.app_role
    and deleted_at is null;

  return found;
end
$$;

revoke all on function app.set_user_app_role(uuid, app.app_role) from public;
grant execute on function app.set_user_app_role(uuid, app.app_role) to authenticated;

create or replace function app.current_user_email()
returns text
language sql
stable
security definer
set search_path = app, pg_temp
as $$
  select actor.email
  from app.users as actor
  where actor.id = (select app.current_user_id())
    and actor.deleted_at is null
  limit 1
$$;

revoke all on function app.current_user_email() from public;
grant execute on function app.current_user_email() to authenticated;

create or replace function app.workspace_has_pending_invitation(
  target_workspace_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = app, pg_temp
as $$
  select exists (
    select 1
    from app.workspace_invitations as invitation
    where invitation.workspace_id = target_workspace_id
      and invitation.email = (select app.current_user_email())
      and invitation.accepted_at is null
      and invitation.declined_at is null
      and invitation.deleted_at is null
  )
$$;

revoke all on function app.workspace_has_pending_invitation(uuid) from public;
grant execute on function app.workspace_has_pending_invitation(uuid) to authenticated;

create or replace function app.workspace_invitation_allows_membership(
  target_workspace_id uuid,
  target_group_role app.workspace_group_role
)
returns boolean
language sql
stable
security definer
set search_path = app, pg_temp
as $$
  select exists (
    select 1
    from app.workspace_invitations as invitation
    where invitation.workspace_id = target_workspace_id
      and invitation.email = (select app.current_user_email())
      and invitation.group_role = target_group_role
      and invitation.accepted_at is null
      and invitation.declined_at is null
      and invitation.deleted_at is null
  )
$$;

revoke all on function app.workspace_invitation_allows_membership(
  uuid,
  app.workspace_group_role
) from public;
grant execute on function app.workspace_invitation_allows_membership(
  uuid,
  app.workspace_group_role
) to authenticated;

create or replace function app.workspace_is_owned_by_current_user(
  target_workspace_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = app, pg_temp
as $$
  select exists (
    select 1
    from app.workspaces as workspace
    where workspace.id = target_workspace_id
      and workspace.owner_user_id = (select app.current_user_id())
      and workspace.deleted_at is null
  )
$$;

revoke all on function app.workspace_is_owned_by_current_user(uuid) from public;
grant execute on function app.workspace_is_owned_by_current_user(uuid) to authenticated;

grant insert, delete on table app.workspaces to authenticated;
grant update (name) on table app.workspaces to authenticated;

drop policy if exists workspaces_insert_shared_owner on app.workspaces;
create policy workspaces_insert_shared_owner
on app.workspaces
for insert
to authenticated
with check (
  owner_user_id = (select app.current_user_id())
  and kind = 'shared'::app.workspace_kind
  and deleted_at is null
);

drop policy if exists workspaces_update_shared_owner on app.workspaces;
create policy workspaces_update_shared_owner
on app.workspaces
for update
to authenticated
using (
  owner_user_id = (select app.current_user_id())
  and kind = 'shared'::app.workspace_kind
  and deleted_at is null
)
with check (
  owner_user_id = (select app.current_user_id())
  and kind = 'shared'::app.workspace_kind
  and deleted_at is null
);

drop policy if exists workspaces_delete_shared_owner on app.workspaces;
create policy workspaces_delete_shared_owner
on app.workspaces
for delete
to authenticated
using (
  owner_user_id = (select app.current_user_id())
  and kind = 'shared'::app.workspace_kind
  and deleted_at is null
);

drop policy if exists workspace_members_insert_invited_self on app.workspace_members;
drop policy if exists workspace_members_insert_self on app.workspace_members;
create policy workspace_members_insert_self
on app.workspace_members
for insert
to authenticated
with check (
  user_id = (select app.current_user_id())
  and deleted_at is null
  and (
    (
      role = 'owner'::app.workspace_role
      and group_role = 'group_admin'::app.workspace_group_role
      and invited_by is null
      and (select app.workspace_is_owned_by_current_user(workspace_id))
    )
    or (
      role = 'user'::app.workspace_role
      and (select app.workspace_invitation_allows_membership(
        workspace_id,
        group_role
      ))
    )
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
    and (select app.workspace_has_pending_invitation(workspace_id))
  )
)
with check (
  (select app.workspace_can_manage_participants(workspace_id))
  or (
    user_id = (select app.current_user_id())
    and role = 'user'::app.workspace_role
    and (select app.workspace_invitation_allows_membership(
      workspace_id,
      group_role
    ))
  )
);

drop policy if exists workspaces_select_invited_email on app.workspaces;
create policy workspaces_select_invited_email
on app.workspaces
for select
to authenticated
using (
  deleted_at is null
  and (select app.workspace_has_pending_invitation(id))
);

drop policy if exists workspace_invitations_select_manage_or_recipient on app.workspace_invitations;
create policy workspace_invitations_select_manage_or_recipient
on app.workspace_invitations
for select
to authenticated
using (
  deleted_at is null
  and (
    (select app.workspace_can_manage_participants(workspace_id))
    or (
      email = (select app.current_user_email())
      and accepted_at is null
      and declined_at is null
    )
  )
);

drop policy if exists workspace_invitations_update_manage_or_recipient on app.workspace_invitations;
create policy workspace_invitations_update_manage_or_recipient
on app.workspace_invitations
for update
to authenticated
using (
  (select app.workspace_can_manage_participants(workspace_id))
)
with check (
  (select app.workspace_can_manage_participants(workspace_id))
);

create or replace function app.accept_workspace_invitation(
  target_invitation_id uuid
)
returns boolean
language plpgsql
security definer
set search_path = app, pg_temp
as $$
begin
  update app.workspace_invitations
  set
    accepted_at = now(),
    accepted_by = (select app.current_user_id())
  where id = target_invitation_id
    and email = (select app.current_user_email())
    and accepted_at is null
    and declined_at is null
    and deleted_at is null;

  return found;
end
$$;

revoke all on function app.accept_workspace_invitation(uuid) from public;
grant execute on function app.accept_workspace_invitation(uuid) to authenticated;

create or replace function app.decline_workspace_invitation(
  target_invitation_id uuid
)
returns boolean
language plpgsql
security definer
set search_path = app, pg_temp
as $$
begin
  update app.workspace_invitations
  set
    declined_at = now(),
    declined_by = (select app.current_user_id())
  where id = target_invitation_id
    and email = (select app.current_user_email())
    and accepted_at is null
    and declined_at is null
    and deleted_at is null;

  return found;
end
$$;

revoke all on function app.decline_workspace_invitation(uuid) from public;
grant execute on function app.decline_workspace_invitation(uuid) to authenticated;

create or replace function app.leave_shared_workspace(
  target_workspace_id uuid
)
returns boolean
language plpgsql
security definer
set search_path = app, pg_temp
as $$
begin
  update app.workspace_members
  set deleted_at = now()
  where workspace_id = target_workspace_id
    and user_id = (select app.current_user_id())
    and role <> 'owner'::app.workspace_role
    and deleted_at is null;

  return found;
end
$$;

revoke all on function app.leave_shared_workspace(uuid) from public;
grant execute on function app.leave_shared_workspace(uuid) to authenticated;
