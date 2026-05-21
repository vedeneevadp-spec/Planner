-- noinspection SqlNoDataSourceInspection
-- Let the same native client recover from a stale rotated refresh token instead
-- of revoking the whole token family after a missed local token write.
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
  resolved_now timestamptz := now();
  is_same_client boolean := false;
begin
  select
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
    input_user_agent is not null
    and current_token.user_agent is not null
    and input_user_agent = current_token.user_agent;

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

revoke all on function app.auth_rotate_refresh_token(text, uuid, text, timestamptz, text, text) from public;
grant execute on function app.auth_rotate_refresh_token(text, uuid, text, timestamptz, text, text) to authenticated;
