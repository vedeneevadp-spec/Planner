-- noinspection SqlNoDataSourceInspection
-- A rotated refresh token is safe to recover for five minutes only when both
-- tokens carry the same stable device id. Legacy tokens without one fail
-- closed on replay: a User-Agent (or IP address) is not a trustworthy device
-- identity.
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
  idempotent_next_token record;
  token_to_rotate_id uuid;
  recovery_window constant interval := interval '5 minutes';
  resolved_now timestamptz := now();
  normalized_device_id text := case
    when nullif(trim(input_device_id), '') is not null
      and length(trim(input_device_id)) <= 128
    then trim(input_device_id)
    else null
  end;
  is_same_device boolean := false;
begin
  select
    token.device_id,
    token.expires_at,
    token.id as token_id,
    token.replaced_by_token_id,
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
    or current_token.expires_at <= resolved_now
  then
    return;
  end if;

  if current_token.rotated_at is not null then
    is_same_device :=
      normalized_device_id is not null
      and current_token.device_id is not null
      and normalized_device_id = current_token.device_id;

    if not is_same_device
      or current_token.rotated_at + recovery_window < resolved_now
    then
      update auth_refresh_tokens as token
      set revoked_at = resolved_now
      where token.session_id = current_token.session_id
        and token.revoked_at is null;

      return;
    end if;

    -- A database/client retry can repeat the exact rotation command after the
    -- first transaction committed. Return the original success while its
    -- replacement is still the active token instead of rotating it again.
    if current_token.replaced_by_token_id = input_next_token_id then
      select token.id
      into idempotent_next_token
      from auth_refresh_tokens as token
      where token.id = input_next_token_id
        and token.token_hash = input_next_token_hash
        and token.session_id = current_token.session_id
        and token.user_id = current_token.user_id
        and token.device_id = normalized_device_id
        and token.revoked_at is null
        and token.rotated_at is null
        and token.expires_at > resolved_now
      for update;

      if idempotent_next_token is not null then
        return query
          select
            current_token.user_id,
            current_token.email,
            current_token.display_name,
            current_token.session_id;
        return;
      end if;
    end if;

    -- Never let a late duplicate command collide with, or reactivate, a token
    -- which has already moved further down the rotation chain.
    if exists (
      select 1
      from auth_refresh_tokens as token
      where token.id = input_next_token_id
        or token.token_hash = input_next_token_hash
    ) then
      return;
    end if;

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

-- Keep the pre-device signature operational for an old API process during a
-- rolling migration, but pass a null device id so rotated legacy tokens use
-- the same fail-closed policy.
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
language sql
security definer
set search_path = app, pg_temp
as $$
  select *
  from app.auth_rotate_refresh_token(
    input_current_token_hash,
    input_next_token_id,
    input_next_token_hash,
    input_next_expires_at,
    null::text,
    input_user_agent,
    input_ip_address
  )
$$;

revoke all on function app.auth_rotate_refresh_token(text, uuid, text, timestamptz, text, text) from public;
revoke all on function app.auth_rotate_refresh_token(text, uuid, text, timestamptz, text, text, text) from public;

grant execute on function app.auth_rotate_refresh_token(text, uuid, text, timestamptz, text, text) to authenticated;
grant execute on function app.auth_rotate_refresh_token(text, uuid, text, timestamptz, text, text, text) to authenticated;
