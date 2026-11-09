create table app.api_keys (
  id uuid primary key,
  user_id uuid not null references app.users(id) on delete cascade,
  workspace_id uuid not null references app.workspaces(id) on delete cascade,
  name text not null check (char_length(name) between 1 and 80),
  prefix text not null,
  token_hash text not null unique check (token_hash ~ '^[0-9a-f]{64}$'),
  scopes text[] not null check (
    cardinality(scopes) between 1 and 4
    and scopes <@ array['tasks:read', 'tasks:write', 'shopping:read', 'shopping:write']::text[]
    and array_position(scopes, null) is null
  ),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  last_used_at timestamptz,
  revoked_at timestamptz
);
create index api_keys_user_id on app.api_keys(user_id, created_at desc);
alter table app.api_keys enable row level security;
revoke all on app.api_keys from public, authenticated;

-- The isolated backup login must include the new table in logical backups.
create policy planner_backup_select_all on app.api_keys for select to public
  using (session_user = 'planner_backup');

-- Management runs with the signed-in user's RLS claims. Hash lookup is the only
-- pre-authentication operation; it also checks live user/workspace membership.
create function app.api_keys_create(
  p_id uuid, p_workspace_id uuid, p_name text, p_prefix text,
  p_token_hash text, p_scopes text[], p_expires_at timestamptz
) returns setof app.api_keys
language plpgsql security definer set search_path = app, pg_catalog, pg_temp
as $$
declare v_user_id uuid := app.current_user_id();
begin
  perform 1 from app.users where id = v_user_id and deleted_at is null for update;
  if not found or not exists (
    select 1 from app.workspace_members m
    join app.workspaces w on w.id = m.workspace_id and w.deleted_at is null
    where m.user_id = v_user_id and m.workspace_id = p_workspace_id and m.deleted_at is null
  ) then
    raise insufficient_privilege using message = 'API key workspace access denied';
  end if;
  if p_expires_at <= now() or p_expires_at > now() + interval '366 days' then
    raise check_violation using message = 'Invalid API key expiry';
  end if;
  if (select count(*) from app.api_keys where user_id = v_user_id and revoked_at is null and expires_at > now()) >= 20 then
    return;
  end if;
  return query insert into app.api_keys (id, user_id, workspace_id, name, prefix, token_hash, scopes, expires_at)
    values (p_id, v_user_id, p_workspace_id, p_name, p_prefix, p_token_hash, p_scopes, p_expires_at)
    returning *;
end;
$$;

create function app.api_keys_list() returns setof app.api_keys
language sql stable security definer set search_path = app, pg_catalog, pg_temp
as $$
  select * from app.api_keys where user_id = app.current_user_id() order by created_at desc;
$$;

create function app.api_keys_revoke(p_id uuid) returns boolean
language plpgsql security definer set search_path = app, pg_catalog, pg_temp
as $$
begin
  update app.api_keys set revoked_at = coalesce(revoked_at, now())
  where id = p_id and user_id = app.current_user_id();
  return found;
end;
$$;

create function app.api_keys_authenticate(p_hash text) returns setof app.api_keys
language sql security definer set search_path = app, pg_catalog, pg_temp
as $$
  update app.api_keys k set last_used_at = now()
  where k.token_hash = p_hash and k.revoked_at is null and k.expires_at > now()
    and exists (select 1 from app.users u where u.id = k.user_id and u.deleted_at is null)
    and exists (
      select 1 from app.workspace_members m
      join app.workspaces w on w.id = m.workspace_id and w.deleted_at is null
      where m.user_id = k.user_id and m.workspace_id = k.workspace_id and m.deleted_at is null
    )
  returning k.*;
$$;

revoke all on function app.api_keys_create(uuid, uuid, text, text, text, text[], timestamptz) from public;
revoke all on function app.api_keys_list() from public;
revoke all on function app.api_keys_revoke(uuid) from public;
revoke all on function app.api_keys_authenticate(text) from public;
grant execute on function app.api_keys_create(uuid, uuid, text, text, text, text[], timestamptz) to authenticated;
grant execute on function app.api_keys_list() to authenticated;
grant execute on function app.api_keys_revoke(uuid) to authenticated;
grant execute on function app.api_keys_authenticate(text) to authenticated;

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'planner_backup') then
    revoke all on app.api_keys from planner_backup;
    grant select on app.api_keys to planner_backup;
    revoke execute on function app.api_keys_create(uuid, uuid, text, text, text, text[], timestamptz) from planner_backup;
    revoke execute on function app.api_keys_list() from planner_backup;
    revoke execute on function app.api_keys_revoke(uuid) from planner_backup;
    revoke execute on function app.api_keys_authenticate(text) from planner_backup;
  end if;
end;
$$;
