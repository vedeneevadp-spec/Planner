-- noinspection SqlNoDataSourceInspection
-- Bind refresh-token replay recovery to a stable native device id when present.
alter table app.auth_refresh_tokens
  add column if not exists device_id text;

create index if not exists auth_refresh_tokens_device_session_idx
  on app.auth_refresh_tokens (device_id, session_id, created_at desc)
  where device_id is not null;

create or replace function app.auth_insert_refresh_token(
  input_id uuid,
  input_user_id uuid,
  input_token_hash text,
  input_session_id uuid,
  input_expires_at timestamptz,
  input_device_id text,
  input_user_agent text,
  input_ip_address text
)
returns void
language sql
security definer
set search_path = app, pg_temp
as $$
  insert into auth_refresh_tokens (
    device_id,
    expires_at,
    id,
    ip_address,
    session_id,
    token_hash,
    user_agent,
    user_id
  )
  values (
    case
      when nullif(trim(input_device_id), '') is not null
        and length(trim(input_device_id)) <= 128
      then trim(input_device_id)
      else null
    end,
    input_expires_at,
    input_id,
    input_ip_address,
    input_session_id,
    input_token_hash,
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
  input_refresh_device_id text,
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
    input_refresh_device_id,
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
  input_device_id text,
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
  resolved_now timestamptz := now();
  normalized_device_id text := case
    when nullif(trim(input_device_id), '') is not null
      and length(trim(input_device_id)) <= 128
    then trim(input_device_id)
    else null
  end;
  is_same_client boolean := false;
begin
  select
    token.device_id,
    token.expires_at,
    token.id as token_id,
    token.revoked_at,
    token.rotated_at,
    token.session_id,
    token.user_agent,
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
    or current_token.expires_at <= resolved_now
  then
    return;
  end if;

  is_same_client :=
    (
      normalized_device_id is not null
      and current_token.device_id is not null
      and normalized_device_id = current_token.device_id
    )
    or (
      current_token.device_id is null
      and input_user_agent is not null
      and current_token.user_agent is not null
      and input_user_agent = current_token.user_agent
    );

  if current_token.rotated_at is not null
    and resolved_now - current_token.rotated_at > interval '24 hours'
    and not is_same_client
  then
    update auth_refresh_tokens as token
    set revoked_at = resolved_now
    where token.session_id = current_token.session_id
      and token.revoked_at is null;

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
      and token.expires_at > resolved_now
    order by token.created_at desc
    limit 1
    for update;
  else
    token_to_rotate_id := current_token.token_id;
  end if;

  if token_to_rotate_id is null then
    return;
  end if;

  update auth_refresh_tokens as token
  set
    last_used_at = resolved_now,
    rotated_at = resolved_now
  where token.id = token_to_rotate_id
    and token.revoked_at is null
    and token.rotated_at is null;

  if not found then
    return;
  end if;

  perform app.auth_insert_refresh_token(
    input_next_token_id,
    current_token.user_id,
    input_next_token_hash,
    current_token.session_id,
    input_next_expires_at,
    normalized_device_id,
    input_user_agent,
    input_ip_address
  );

  update auth_refresh_tokens as token
  set replaced_by_token_id = input_next_token_id
  where token.id = token_to_rotate_id;

  return query
    select
      current_token.user_id,
      current_token.email,
      current_token.display_name,
      current_token.session_id;
end;
$$;

create or replace function app.auth_complete_password_reset(
  input_reset_token_hash text,
  input_password_hash text,
  input_refresh_token_id uuid,
  input_refresh_token_hash text,
  input_refresh_session_id uuid,
  input_refresh_expires_at timestamptz,
  input_refresh_device_id text,
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
    input_refresh_device_id,
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

revoke all on function app.auth_insert_refresh_token(uuid, uuid, text, uuid, timestamptz, text, text) from public;
revoke all on function app.auth_exchange_oauth_authorization_code(text, text, text, uuid, text, uuid, timestamptz, text, text) from public;
revoke all on function app.auth_rotate_refresh_token(text, uuid, text, timestamptz, text, text) from public;
revoke all on function app.auth_complete_password_reset(text, text, uuid, text, uuid, timestamptz, text, text) from public;

revoke all on function app.auth_insert_refresh_token(uuid, uuid, text, uuid, timestamptz, text, text, text) from public;
revoke all on function app.auth_exchange_oauth_authorization_code(text, text, text, uuid, text, uuid, timestamptz, text, text, text) from public;
revoke all on function app.auth_rotate_refresh_token(text, uuid, text, timestamptz, text, text, text) from public;
revoke all on function app.auth_complete_password_reset(text, text, uuid, text, uuid, timestamptz, text, text, text) from public;

-- Keep previous runtime signatures executable during rolling API deploys. They
-- cannot attach a stable device id, but failing them during deploy is a worse
-- auth-stability failure mode than falling back to legacy user-agent behavior.
grant execute on function app.auth_insert_refresh_token(uuid, uuid, text, uuid, timestamptz, text, text) to authenticated;
grant execute on function app.auth_exchange_oauth_authorization_code(text, text, text, uuid, text, uuid, timestamptz, text, text) to authenticated;
grant execute on function app.auth_rotate_refresh_token(text, uuid, text, timestamptz, text, text) to authenticated;
grant execute on function app.auth_complete_password_reset(text, text, uuid, text, uuid, timestamptz, text, text) to authenticated;

grant execute on function app.auth_insert_refresh_token(uuid, uuid, text, uuid, timestamptz, text, text, text) to authenticated;
grant execute on function app.auth_exchange_oauth_authorization_code(text, text, text, uuid, text, uuid, timestamptz, text, text, text) to authenticated;
grant execute on function app.auth_rotate_refresh_token(text, uuid, text, timestamptz, text, text, text) to authenticated;
grant execute on function app.auth_complete_password_reset(text, text, uuid, text, uuid, timestamptz, text, text, text) to authenticated;
