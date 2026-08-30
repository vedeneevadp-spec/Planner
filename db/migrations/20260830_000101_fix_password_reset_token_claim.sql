-- noinspection SqlNoDataSourceInspection

-- auth_complete_password_reset returns a column named id. In PL/pgSQL that
-- output column is also a variable, so the previous unqualified `where id =`
-- token claim was ambiguous and aborted every valid password reset.
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
    password_reset_token.expires_at,
    password_reset_token.id as token_id,
    password_reset_token.used_at,
    user_row.deleted_at as user_deleted_at,
    user_row.display_name,
    user_row.email,
    user_row.id as user_id
  into reset_token
  from auth_password_reset_tokens as password_reset_token
  inner join users as user_row
    on user_row.id = password_reset_token.user_id
  where password_reset_token.token_hash = input_reset_token_hash
  limit 1;

  if reset_token is null
    or reset_token.used_at is not null
    or reset_token.user_deleted_at is not null
    or reset_token.expires_at <= now()
  then
    return;
  end if;

  update auth_password_reset_tokens as password_reset_token
  set used_at = now()
  where password_reset_token.id = reset_token.token_id
    and password_reset_token.used_at is null;

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

  update auth_refresh_tokens as refresh_token
  set revoked_at = now()
  where refresh_token.user_id = reset_token.user_id
    and refresh_token.revoked_at is null;

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

revoke all on function app.auth_complete_password_reset(
  text,
  text,
  uuid,
  text,
  uuid,
  timestamptz,
  text,
  text,
  text
) from public;
grant execute on function app.auth_complete_password_reset(
  text,
  text,
  uuid,
  text,
  uuid,
  timestamptz,
  text,
  text,
  text
) to authenticated;
