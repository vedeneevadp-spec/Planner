-- noinspection SqlNoDataSourceInspection
create or replace function app.auth_find_credential_by_email(input_email public.citext)
returns table (
  id uuid,
  email public.citext,
  display_name text,
  password_hash text
)
language sql
stable
security definer
set search_path = app, pg_temp
as $$
  select
    user_row.id,
    credential.email,
    user_row.display_name,
    credential.password_hash
  from auth_credentials as credential
  inner join users as user_row
    on user_row.id = credential.user_id
  where credential.email = lower(input_email::text)::public.citext
    and credential.deleted_at is null
    and user_row.deleted_at is null
  limit 1
$$;

create or replace function app.auth_find_credential_by_user_id(input_user_id uuid)
returns table (
  id uuid,
  email public.citext,
  display_name text,
  password_hash text
)
language sql
stable
security definer
set search_path = app, pg_temp
as $$
  select
    user_row.id,
    credential.email,
    user_row.display_name,
    credential.password_hash
  from auth_credentials as credential
  inner join users as user_row
    on user_row.id = credential.user_id
  where credential.user_id = input_user_id
    and credential.deleted_at is null
    and user_row.deleted_at is null
  limit 1
$$;

create or replace function app.auth_find_user_by_email(input_email public.citext)
returns table (
  id uuid,
  email public.citext,
  display_name text
)
language sql
stable
security definer
set search_path = app, pg_temp
as $$
  select
    user_row.id,
    user_row.email,
    user_row.display_name
  from users as user_row
  where user_row.email = lower(input_email::text)::public.citext
    and user_row.deleted_at is null
  limit 1
$$;

create or replace function app.auth_create_user_with_credential(
  input_user_id uuid,
  input_email public.citext,
  input_display_name text,
  input_password_hash text
)
returns table (
  id uuid,
  email public.citext,
  display_name text
)
language plpgsql
security definer
set search_path = app, pg_temp
as $$
declare
  resolved_app_role app.app_role := 'user';
begin
  if not exists (
    select 1
    from users as user_row
    where user_row.app_role = 'owner'
      and user_row.deleted_at is null
  ) then
    resolved_app_role := 'owner';
  end if;

  insert into users (
    app_role,
    display_name,
    email,
    id,
    locale,
    timezone
  )
  values (
    resolved_app_role,
    input_display_name,
    lower(input_email::text)::public.citext,
    input_user_id,
    'ru-RU',
    'Asia/Novosibirsk'
  );

  insert into auth_credentials (
    email,
    password_hash,
    user_id
  )
  values (
    lower(input_email::text)::public.citext,
    input_password_hash,
    input_user_id
  );

  return query
    select
      user_row.id,
      user_row.email,
      user_row.display_name
    from users as user_row
    where user_row.id = input_user_id;
end;
$$;

create or replace function app.auth_insert_refresh_token(
  input_id uuid,
  input_user_id uuid,
  input_token_hash text,
  input_session_id uuid,
  input_expires_at timestamptz,
  input_user_agent text,
  input_ip_address text
)
returns void
language sql
security definer
set search_path = app, pg_temp
as $$
  insert into auth_refresh_tokens (
    expires_at,
    id,
    ip_address,
    session_id,
    token_hash,
    user_agent,
    user_id
  )
  values (
    input_expires_at,
    input_id,
    input_ip_address,
    input_session_id,
    input_token_hash,
    input_user_agent,
    input_user_id
  )
$$;

create or replace function app.auth_create_oauth_authorization_code(
  input_id uuid,
  input_user_id uuid,
  input_code_hash text,
  input_client_id text,
  input_redirect_uri text,
  input_scope text,
  input_expires_at timestamptz,
  input_user_agent text,
  input_ip_address text
)
returns void
language sql
security definer
set search_path = app, pg_temp
as $$
  insert into oauth_authorization_codes (
    client_id,
    code_hash,
    expires_at,
    id,
    ip_address,
    redirect_uri,
    scope,
    user_agent,
    user_id
  )
  values (
    input_client_id,
    input_code_hash,
    input_expires_at,
    input_id,
    input_ip_address,
    input_redirect_uri,
    input_scope,
    input_user_agent,
    input_user_id
  )
$$;

create or replace function app.auth_exchange_oauth_authorization_code(
  input_code_hash text,
  input_client_id text,
  input_redirect_uri text,
  input_refresh_token_id uuid,
  input_refresh_token_hash text,
  input_refresh_session_id uuid,
  input_refresh_expires_at timestamptz,
  input_user_agent text,
  input_ip_address text
)
returns table (
  id uuid,
  email public.citext,
  display_name text,
  session_id uuid
)
language plpgsql
security definer
set search_path = app, pg_temp
as $$
declare
  authorization_code record;
begin
  select
    code.client_id,
    code.consumed_at,
    code.expires_at,
    code.id as code_id,
    code.redirect_uri,
    user_row.deleted_at as user_deleted_at,
    user_row.display_name,
    user_row.email,
    user_row.id as user_id
  into authorization_code
  from oauth_authorization_codes as code
  inner join users as user_row
    on user_row.id = code.user_id
  where code.code_hash = input_code_hash
  limit 1;

  if authorization_code is null
    or authorization_code.client_id <> input_client_id
    or authorization_code.redirect_uri <> input_redirect_uri
    or authorization_code.consumed_at is not null
    or authorization_code.user_deleted_at is not null
    or authorization_code.expires_at <= now()
  then
    return;
  end if;

  update oauth_authorization_codes
  set consumed_at = now()
  where id = authorization_code.code_id
    and consumed_at is null;

  if not found then
    return;
  end if;

  perform app.auth_insert_refresh_token(
    input_refresh_token_id,
    authorization_code.user_id,
    input_refresh_token_hash,
    input_refresh_session_id,
    input_refresh_expires_at,
    input_user_agent,
    input_ip_address
  );

  return query
    select
      authorization_code.user_id,
      authorization_code.email,
      authorization_code.display_name,
      input_refresh_session_id;
end;
$$;

create or replace function app.auth_rotate_refresh_token(
  input_current_token_hash text,
  input_next_token_id uuid,
  input_next_token_hash text,
  input_next_expires_at timestamptz,
  input_user_agent text,
  input_ip_address text
)
returns table (
  id uuid,
  email public.citext,
  display_name text,
  session_id uuid
)
language plpgsql
security definer
set search_path = app, pg_temp
as $$
declare
  current_token record;
  token_to_rotate_id uuid;
  current_time timestamptz := now();
begin
  select
    token.expires_at,
    token.id as token_id,
    token.revoked_at,
    token.rotated_at,
    token.session_id,
    user_row.deleted_at as user_deleted_at,
    user_row.display_name,
    user_row.email,
    user_row.id as user_id
  into current_token
  from auth_refresh_tokens as token
  inner join users as user_row
    on user_row.id = token.user_id
  where token.token_hash = input_current_token_hash
  for update;

  if current_token is null
    or current_token.revoked_at is not null
    or current_token.user_deleted_at is not null
    or current_token.expires_at <= current_time
  then
    return;
  end if;

  if current_token.rotated_at is not null
    and current_time - current_token.rotated_at > interval '24 hours'
  then
    update auth_refresh_tokens
    set revoked_at = current_time
    where session_id = current_token.session_id
      and revoked_at is null;

    return;
  end if;

  if current_token.rotated_at is not null then
    select token.id
    into token_to_rotate_id
    from auth_refresh_tokens as token
    where token.session_id = current_token.session_id
      and token.user_id = current_token.user_id
      and token.revoked_at is null
      and token.rotated_at is null
      and token.expires_at > current_time
    order by token.created_at desc
    limit 1
    for update;
  else
    token_to_rotate_id := current_token.token_id;
  end if;

  if token_to_rotate_id is null then
    return;
  end if;

  update auth_refresh_tokens
  set
    last_used_at = current_time,
    rotated_at = current_time
  where id = token_to_rotate_id
    and revoked_at is null
    and rotated_at is null;

  if not found then
    return;
  end if;

  perform app.auth_insert_refresh_token(
    input_next_token_id,
    current_token.user_id,
    input_next_token_hash,
    current_token.session_id,
    input_next_expires_at,
    input_user_agent,
    input_ip_address
  );

  update auth_refresh_tokens
  set replaced_by_token_id = input_next_token_id
  where id = token_to_rotate_id;

  return query
    select
      current_token.user_id,
      current_token.email,
      current_token.display_name,
      current_token.session_id;
end;
$$;

create or replace function app.auth_revoke_refresh_token(input_refresh_token_hash text)
returns void
language plpgsql
security definer
set search_path = app, pg_temp
as $$
declare
  resolved_session_id uuid;
begin
  select token.session_id
  into resolved_session_id
  from auth_refresh_tokens as token
  where token.token_hash = input_refresh_token_hash
  limit 1;

  if resolved_session_id is null then
    return;
  end if;

  update auth_refresh_tokens
  set revoked_at = now()
  where session_id = resolved_session_id
    and revoked_at is null;
end;
$$;

create or replace function app.auth_create_password_reset_token(
  input_user_id uuid,
  input_token_hash text,
  input_expires_at timestamptz,
  input_user_agent text,
  input_ip_address text
)
returns void
language plpgsql
security definer
set search_path = app, pg_temp
as $$
begin
  update auth_password_reset_tokens
  set used_at = now()
  where user_id = input_user_id
    and used_at is null;

  insert into auth_password_reset_tokens (
    expires_at,
    id,
    ip_address,
    token_hash,
    user_agent,
    user_id
  )
  values (
    input_expires_at,
    public.gen_random_uuid(),
    input_ip_address,
    input_token_hash,
    input_user_agent,
    input_user_id
  );
end;
$$;

create or replace function app.auth_complete_password_reset(
  input_reset_token_hash text,
  input_password_hash text,
  input_refresh_token_id uuid,
  input_refresh_token_hash text,
  input_refresh_session_id uuid,
  input_refresh_expires_at timestamptz,
  input_user_agent text,
  input_ip_address text
)
returns table (
  id uuid,
  email public.citext,
  display_name text,
  session_id uuid
)
language plpgsql
security definer
set search_path = app, pg_temp
as $$
declare
  reset_token record;
begin
  select
    token.expires_at,
    token.id as token_id,
    token.used_at,
    user_row.deleted_at as user_deleted_at,
    user_row.display_name,
    user_row.email,
    user_row.id as user_id
  into reset_token
  from auth_password_reset_tokens as token
  inner join users as user_row
    on user_row.id = token.user_id
  where token.token_hash = input_reset_token_hash
  limit 1;

  if reset_token is null
    or reset_token.used_at is not null
    or reset_token.user_deleted_at is not null
    or reset_token.expires_at <= now()
  then
    return;
  end if;

  update auth_password_reset_tokens
  set used_at = now()
  where id = reset_token.token_id
    and used_at is null;

  if not found then
    return;
  end if;

  insert into auth_credentials (
    email,
    password_hash,
    password_updated_at,
    user_id
  )
  values (
    reset_token.email,
    input_password_hash,
    now(),
    reset_token.user_id
  )
  on conflict (user_id) do update
    set
      deleted_at = null,
      email = excluded.email,
      password_hash = excluded.password_hash,
      password_updated_at = excluded.password_updated_at;

  update auth_refresh_tokens
  set revoked_at = now()
  where user_id = reset_token.user_id
    and revoked_at is null;

  perform app.auth_insert_refresh_token(
    input_refresh_token_id,
    reset_token.user_id,
    input_refresh_token_hash,
    input_refresh_session_id,
    input_refresh_expires_at,
    input_user_agent,
    input_ip_address
  );

  return query
    select
      reset_token.user_id,
      reset_token.email,
      reset_token.display_name,
      input_refresh_session_id;
end;
$$;

create or replace function app.auth_update_password(
  input_user_id uuid,
  input_password_hash text
)
returns boolean
language plpgsql
security definer
set search_path = app, pg_temp
as $$
declare
  resolved_email public.citext;
begin
  select user_row.email
  into resolved_email
  from users as user_row
  where user_row.id = input_user_id
    and user_row.deleted_at is null
  limit 1;

  if resolved_email is null then
    return false;
  end if;

  insert into auth_credentials (
    email,
    password_hash,
    password_updated_at,
    user_id
  )
  values (
    resolved_email,
    input_password_hash,
    now(),
    input_user_id
  )
  on conflict (user_id) do update
    set
      deleted_at = null,
      email = excluded.email,
      password_hash = excluded.password_hash,
      password_updated_at = excluded.password_updated_at;

  update auth_refresh_tokens
  set revoked_at = now()
  where user_id = input_user_id
    and revoked_at is null;

  return true;
end;
$$;

create or replace function app.session_provision_personal_workspace(
  input_actor_user_id uuid,
  input_workspace_id uuid,
  input_membership_id uuid,
  input_workspace_name text,
  input_workspace_slug text,
  input_role app.workspace_role
)
returns table (
  provisioned_workspace_id uuid
)
language plpgsql
security definer
set search_path = app, pg_temp
as $$
declare
  claims_user_id uuid := app.current_user_id();
begin
  if claims_user_id is null or claims_user_id <> input_actor_user_id then
    raise insufficient_privilege
      using message = 'session_provision_personal_workspace requires current JWT subject to match actor user.';
  end if;

  if input_role <> 'owner' then
    raise check_violation
      using message = 'Personal workspace bootstrap requires owner membership.';
  end if;

  return query
    with inserted_workspace as (
      insert into workspaces (
        description,
        id,
        kind,
        name,
        owner_user_id,
        slug
      )
      values (
        '',
        input_workspace_id,
        'personal'::app.workspace_kind,
        input_workspace_name,
        input_actor_user_id,
        input_workspace_slug
      )
      on conflict (slug) do nothing
      returning id
    ),
    resolved_workspace as (
      select id as resolved_workspace_id from inserted_workspace
      union all
      select workspace.id as resolved_workspace_id
      from workspaces as workspace
      where workspace.slug = input_workspace_slug
        and workspace.owner_user_id = input_actor_user_id
        and workspace.kind = 'personal'
        and workspace.deleted_at is null
        and not exists (select 1 from inserted_workspace)
    ),
    inserted_membership as (
      insert into workspace_members (
        id,
        role,
        user_id,
        workspace_id
      )
      select
        input_membership_id,
        input_role,
        input_actor_user_id,
        resolved_workspace.resolved_workspace_id
      from resolved_workspace
      on conflict (workspace_id, user_id) do nothing
      returning id
    )
    select resolved_workspace_id
    from resolved_workspace;
end;
$$;

revoke all on function app.auth_find_credential_by_email(public.citext) from public;
revoke all on function app.auth_find_credential_by_user_id(uuid) from public;
revoke all on function app.auth_find_user_by_email(public.citext) from public;
revoke all on function app.auth_create_user_with_credential(uuid, public.citext, text, text) from public;
revoke all on function app.auth_insert_refresh_token(uuid, uuid, text, uuid, timestamptz, text, text) from public;
revoke all on function app.auth_create_oauth_authorization_code(uuid, uuid, text, text, text, text, timestamptz, text, text) from public;
revoke all on function app.auth_exchange_oauth_authorization_code(text, text, text, uuid, text, uuid, timestamptz, text, text) from public;
revoke all on function app.auth_rotate_refresh_token(text, uuid, text, timestamptz, text, text) from public;
revoke all on function app.auth_revoke_refresh_token(text) from public;
revoke all on function app.auth_create_password_reset_token(uuid, text, timestamptz, text, text) from public;
revoke all on function app.auth_complete_password_reset(text, text, uuid, text, uuid, timestamptz, text, text) from public;
revoke all on function app.auth_update_password(uuid, text) from public;
revoke all on function app.session_provision_personal_workspace(uuid, uuid, uuid, text, text, app.workspace_role) from public;

grant execute on function app.auth_find_credential_by_email(public.citext) to authenticated;
grant execute on function app.auth_find_credential_by_user_id(uuid) to authenticated;
grant execute on function app.auth_find_user_by_email(public.citext) to authenticated;
grant execute on function app.auth_create_user_with_credential(uuid, public.citext, text, text) to authenticated;
grant execute on function app.auth_insert_refresh_token(uuid, uuid, text, uuid, timestamptz, text, text) to authenticated;
grant execute on function app.auth_create_oauth_authorization_code(uuid, uuid, text, text, text, text, timestamptz, text, text) to authenticated;
grant execute on function app.auth_exchange_oauth_authorization_code(text, text, text, uuid, text, uuid, timestamptz, text, text) to authenticated;
grant execute on function app.auth_rotate_refresh_token(text, uuid, text, timestamptz, text, text) to authenticated;
grant execute on function app.auth_revoke_refresh_token(text) to authenticated;
grant execute on function app.auth_create_password_reset_token(uuid, text, timestamptz, text, text) to authenticated;
grant execute on function app.auth_complete_password_reset(text, text, uuid, text, uuid, timestamptz, text, text) to authenticated;
grant execute on function app.auth_update_password(uuid, text) to authenticated;
grant execute on function app.session_provision_personal_workspace(uuid, uuid, uuid, text, text, app.workspace_role) to authenticated;
