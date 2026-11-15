-- One database transaction owns both consumption and successor creation.
create function app.mcp_oauth_rotate_refresh_token(
  p_refresh_token_hash text,
  p_client_id text,
  p_issuer text,
  p_resource text,
  p_next_access_token_hash text,
  p_next_refresh_token_hash text,
  p_expires_at timestamptz
)
returns setof app.mcp_oauth_tokens
language plpgsql
security definer
set search_path = pg_catalog, app
as $$
declare
  previous_token app.mcp_oauth_tokens;
  next_token app.mcp_oauth_tokens;
begin
  select * into previous_token
  from app.mcp_oauth_tokens
  where refresh_token_hash = p_refresh_token_hash
    and revoked_at is null
  for update;

  if not found
    or previous_token.client_id is distinct from p_client_id
    or previous_token.issuer <> p_issuer
    or previous_token.resource <> p_resource
  then
    return;
  end if;

  update app.mcp_oauth_tokens
  set revoked_at = now()
  where id = previous_token.id;

  insert into app.mcp_oauth_tokens (
    user_id, client_id, issuer, resource, access_token_hash,
    refresh_token_hash, scopes, expires_at, created_at
  ) values (
    previous_token.user_id, previous_token.client_id,
    previous_token.issuer, previous_token.resource,
    p_next_access_token_hash, p_next_refresh_token_hash,
    previous_token.scopes, p_expires_at, previous_token.created_at
  ) returning * into next_token;

  return next next_token;
end;
$$;

revoke all on function app.mcp_oauth_rotate_refresh_token(text, text, text, text, text, text, timestamptz) from public;
grant execute on function app.mcp_oauth_rotate_refresh_token(text, text, text, text, text, text, timestamptz) to authenticated;
