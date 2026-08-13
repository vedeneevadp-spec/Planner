-- Access JWTs carry the refresh-token session_id. Validate that session on
-- every authenticated request so logout and password changes revoke access
-- immediately instead of waiting for the JWT expiry time.

create or replace function app.auth_is_session_active(
  input_user_id uuid,
  input_session_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = app, pg_catalog, pg_temp
as $$
  select exists (
    select 1
    from app.auth_refresh_tokens as token
    where token.user_id = input_user_id
      and token.session_id = input_session_id
      and token.revoked_at is null
      and token.rotated_at is null
      and token.expires_at > now()
  );
$$;

revoke all on function app.auth_is_session_active(uuid, uuid) from public;
grant execute on function app.auth_is_session_active(uuid, uuid)
  to authenticated;

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'planner_runtime') then
    grant execute on function app.auth_is_session_active(uuid, uuid)
      to planner_runtime;
  end if;
end;
$$;
