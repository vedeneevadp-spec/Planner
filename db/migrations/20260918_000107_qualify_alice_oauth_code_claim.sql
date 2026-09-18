-- noinspection SqlNoDataSourceInspection
-- Fresh/upgrade verification exposed the existing OUT id / column id ambiguity
-- in both Alice OAuth exchange overloads. Qualify only the consumed-code update;
-- CREATE OR REPLACE preserves the signatures, ACLs and security-definer policy.
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

  update oauth_authorization_codes as code_row
  set consumed_at = now()
  where code_row.id = authorization_code.code_id
    and code_row.consumed_at is null;

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

  update oauth_authorization_codes as code_row
  set consumed_at = now()
  where code_row.id = authorization_code.code_id
    and code_row.consumed_at is null;

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
