-- noinspection SqlNoDataSourceInspection

revoke update (app_role) on table app.users from authenticated;
grant update (app_role) on table app.users to authenticated;

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

create or replace function app.authorize_user_app_role_update()
returns trigger
language plpgsql
security definer
set search_path = app, pg_temp
as $$
declare
  actor_user_id uuid := app.current_user_id();
begin
  if new.app_role is not distinct from old.app_role then
    return new;
  end if;

  -- Owner/admin maintenance connections do not carry request claims.
  if actor_user_id is null then
    return new;
  end if;

  if (select app.current_user_app_role()) <> 'owner'::app.app_role
    or old.app_role = 'owner'::app.app_role
    or new.app_role = 'owner'::app.app_role
  then
    raise exception 'Application role update is not allowed.'
      using errcode = '42501';
  end if;

  return new;
end
$$;

revoke all on function app.authorize_user_app_role_update() from public;

drop trigger if exists users_authorize_app_role_update on app.users;
create trigger users_authorize_app_role_update
before update on app.users
for each row execute function app.authorize_user_app_role_update();

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
  or (
    user_id = (select app.current_user_id())
    and role <> 'owner'::app.workspace_role
    and deleted_at is null
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
  or (
    user_id = (select app.current_user_id())
    and role <> 'owner'::app.workspace_role
    and deleted_at is not null
  )
);

revoke update on table app.workspace_members from authenticated;
grant update (
  deleted_at,
  group_role,
  invited_by,
  role
) on table app.workspace_members to authenticated;

create or replace function app.authorize_workspace_member_update()
returns trigger
language plpgsql
security definer
set search_path = app, pg_temp
as $$
declare
  actor_user_id uuid := app.current_user_id();
  actor_can_manage boolean;
  invitation_matches boolean;
  immutable_fields_changed boolean;
begin
  -- Owner/admin maintenance connections do not carry request claims.
  if actor_user_id is null then
    return new;
  end if;

  immutable_fields_changed :=
    new.id is distinct from old.id
    or new.workspace_id is distinct from old.workspace_id
    or new.user_id is distinct from old.user_id
    or new.joined_at is distinct from old.joined_at
    or new.created_at is distinct from old.created_at;

  if immutable_fields_changed then
    raise exception 'Workspace membership identity is immutable.'
      using errcode = '42501';
  end if;

  actor_can_manage := app.workspace_can_manage_participants(old.workspace_id);

  if actor_can_manage
    and old.role <> 'owner'::app.workspace_role
    and new.role is not distinct from old.role
    and new.invited_by is not distinct from old.invited_by
    and (
      (
        old.deleted_at is null
        and new.deleted_at is null
      )
      or (
        old.deleted_at is null
        and new.deleted_at is not null
        and new.group_role is not distinct from old.group_role
      )
    )
  then
    return new;
  end if;

  if old.user_id = actor_user_id
    and old.role <> 'owner'::app.workspace_role
    and new.role is not distinct from old.role
    and new.group_role is not distinct from old.group_role
    and new.invited_by is not distinct from old.invited_by
    and old.deleted_at is null
    and new.deleted_at is not null
  then
    return new;
  end if;

  select exists (
    select 1
    from app.workspace_invitations as invitation
    where invitation.workspace_id = old.workspace_id
      and invitation.email = (select app.current_user_email())
      and invitation.group_role = new.group_role
      and invitation.invited_by is not distinct from new.invited_by
      and invitation.accepted_at is null
      and invitation.declined_at is null
      and invitation.deleted_at is null
  )
  into invitation_matches;

  if old.user_id = actor_user_id
    and old.role <> 'owner'::app.workspace_role
    and new.role = 'user'::app.workspace_role
    and old.deleted_at is not null
    and new.deleted_at is null
    and invitation_matches
  then
    return new;
  end if;

  raise exception 'Workspace membership update is not allowed.'
    using errcode = '42501';
end
$$;

revoke all on function app.authorize_workspace_member_update() from public;

drop trigger if exists workspace_members_authorize_update on app.workspace_members;
create trigger workspace_members_authorize_update
before update on app.workspace_members
for each row execute function app.authorize_workspace_member_update();

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
  (select app.workspace_can_manage_participants(workspace_id))
  or (
    deleted_at is null
    and (
      email = (select app.current_user_email())
      and (
        (
          accepted_at is null
          and declined_at is null
        )
        or accepted_by = (select app.current_user_id())
        or declined_by = (select app.current_user_id())
      )
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
  or (
    email = (select app.current_user_email())
    and accepted_at is null
    and declined_at is null
    and deleted_at is null
  )
)
with check (
  (select app.workspace_can_manage_participants(workspace_id))
  or (
    email = (select app.current_user_email())
    and deleted_at is null
    and (
      (
        accepted_by = (select app.current_user_id())
        and accepted_at is not null
        and declined_by is null
        and declined_at is null
      )
      or (
        declined_by = (select app.current_user_id())
        and declined_at is not null
        and accepted_by is null
        and accepted_at is null
      )
    )
  )
);

revoke update on table app.workspace_invitations from authenticated;
grant update (
  accepted_at,
  accepted_by,
  declined_at,
  declined_by,
  deleted_at,
  group_role,
  invited_by
) on table app.workspace_invitations to authenticated;

create or replace function app.authorize_workspace_invitation_update()
returns trigger
language plpgsql
security definer
set search_path = app, pg_temp
as $$
declare
  actor_user_id uuid := app.current_user_id();
  actor_email text;
  actor_can_manage boolean;
  immutable_fields_changed boolean;
begin
  -- Owner/admin maintenance connections do not carry request claims.
  if actor_user_id is null then
    return new;
  end if;

  immutable_fields_changed :=
    new.id is distinct from old.id
    or new.workspace_id is distinct from old.workspace_id
    or new.email is distinct from old.email
    or new.created_at is distinct from old.created_at;

  if immutable_fields_changed then
    raise exception 'Workspace invitation scope is immutable.'
      using errcode = '42501';
  end if;

  actor_can_manage := app.workspace_can_manage_participants(old.workspace_id);

  -- Legacy createWorkspaceInvitation uses ON CONFLICT to reopen an invite.
  if actor_can_manage
    and new.invited_by = actor_user_id
    and new.accepted_by is null
    and new.accepted_at is null
    and new.declined_by is null
    and new.declined_at is null
    and new.deleted_at is null
  then
    return new;
  end if;

  if actor_can_manage
    and old.accepted_by is not distinct from new.accepted_by
    and old.accepted_at is not distinct from new.accepted_at
    and old.declined_by is not distinct from new.declined_by
    and old.declined_at is not distinct from new.declined_at
    and old.group_role is not distinct from new.group_role
    and old.invited_by is not distinct from new.invited_by
    and old.deleted_at is null
    and new.deleted_at is not null
  then
    return new;
  end if;

  actor_email := app.current_user_email();

  if old.email = actor_email
    and old.group_role is not distinct from new.group_role
    and old.invited_by is not distinct from new.invited_by
    and old.accepted_by is null
    and old.accepted_at is null
    and old.declined_by is null
    and old.declined_at is null
    and old.deleted_at is null
    and new.deleted_at is null
    and (
      (
        new.accepted_by = actor_user_id
        and new.accepted_at is not null
        and new.declined_by is null
        and new.declined_at is null
      )
      or (
        new.declined_by = actor_user_id
        and new.declined_at is not null
        and new.accepted_by is null
        and new.accepted_at is null
      )
    )
  then
    return new;
  end if;

  raise exception 'Workspace invitation update is not allowed.'
    using errcode = '42501';
end
$$;

revoke all on function app.authorize_workspace_invitation_update() from public;

drop trigger if exists workspace_invitations_authorize_update on app.workspace_invitations;
create trigger workspace_invitations_authorize_update
before update on app.workspace_invitations
for each row execute function app.authorize_workspace_invitation_update();

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
