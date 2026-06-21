-- noinspection SqlNoDataSourceInspection
create table if not exists app.mcp_oauth_tokens (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references app.users(id) on delete cascade,
  client_id text,
  issuer text not null default 'https://chaotika.ru',
  resource text not null default 'https://chaotika.ru/mcp',
  access_token_hash text not null unique,
  refresh_token_hash text,
  scopes text[] not null default '{}',
  expires_at timestamptz not null,
  revoked_at timestamptz,
  created_at timestamptz not null default now(),
  last_used_at timestamptz
);

create index if not exists idx_mcp_oauth_tokens_user_id
  on app.mcp_oauth_tokens(user_id);

create index if not exists idx_mcp_oauth_tokens_active
  on app.mcp_oauth_tokens(access_token_hash)
  where revoked_at is null;

create index if not exists idx_mcp_oauth_tokens_refresh_hash_active
  on app.mcp_oauth_tokens(refresh_token_hash)
  where revoked_at is null and refresh_token_hash is not null;

create table if not exists app.mcp_audit_logs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references app.users(id) on delete set null,
  token_id uuid references app.mcp_oauth_tokens(id) on delete set null,
  tool_name text not null,
  input jsonb,
  output_summary jsonb,
  ip_hash text,
  user_agent text,
  created_at timestamptz not null default now()
);

create index if not exists idx_mcp_audit_logs_user_id_created_at
  on app.mcp_audit_logs(user_id, created_at desc);

alter table app.mcp_oauth_tokens enable row level security;
alter table app.mcp_audit_logs enable row level security;

alter table app.mcp_oauth_tokens
  add column if not exists issuer text not null default 'https://chaotika.ru';

alter table app.mcp_oauth_tokens
  add column if not exists resource text not null default 'https://chaotika.ru/mcp';

drop function if exists app.mcp_oauth_create_token(uuid, text, text, text, text[], timestamptz);

create or replace function app.mcp_oauth_create_token(
  p_user_id uuid,
  p_client_id text,
  p_issuer text,
  p_resource text,
  p_access_token_hash text,
  p_refresh_token_hash text,
  p_scopes text[],
  p_expires_at timestamptz
)
returns app.mcp_oauth_tokens
language plpgsql
security definer
set search_path = app, public
as $$
declare
  inserted_token app.mcp_oauth_tokens;
begin
  insert into app.mcp_oauth_tokens (
    user_id,
    client_id,
    issuer,
    resource,
    access_token_hash,
    refresh_token_hash,
    scopes,
    expires_at
  )
  values (
    p_user_id,
    p_client_id,
    p_issuer,
    p_resource,
    p_access_token_hash,
    p_refresh_token_hash,
    p_scopes,
    p_expires_at
  )
  returning * into inserted_token;

  return inserted_token;
end;
$$;

create or replace function app.mcp_oauth_find_by_access_token_hash(
  p_access_token_hash text
)
returns setof app.mcp_oauth_tokens
language sql
stable
security definer
set search_path = app, public
as $$
  select *
  from app.mcp_oauth_tokens
  where access_token_hash = p_access_token_hash
    and revoked_at is null
  limit 1
$$;

create or replace function app.mcp_oauth_find_by_refresh_token_hash(
  p_refresh_token_hash text
)
returns setof app.mcp_oauth_tokens
language sql
stable
security definer
set search_path = app, public
as $$
  select *
  from app.mcp_oauth_tokens
  where refresh_token_hash = p_refresh_token_hash
    and revoked_at is null
  limit 1
$$;

create or replace function app.mcp_oauth_revoke_by_token_hash(
  p_token_hash text
)
returns void
language sql
security definer
set search_path = app, public
as $$
  update app.mcp_oauth_tokens
  set revoked_at = now()
  where revoked_at is null
    and (
      access_token_hash = p_token_hash
      or refresh_token_hash = p_token_hash
    )
$$;

create or replace function app.mcp_oauth_touch_last_used(
  p_token_id uuid
)
returns void
language sql
security definer
set search_path = app, public
as $$
  update app.mcp_oauth_tokens
  set last_used_at = now()
  where id = p_token_id
    and revoked_at is null
$$;

create or replace function app.mcp_audit_create_log(
  p_user_id uuid,
  p_token_id uuid,
  p_tool_name text,
  p_input jsonb,
  p_output_summary jsonb,
  p_ip_hash text,
  p_user_agent text
)
returns void
language sql
security definer
set search_path = app, public
as $$
  insert into app.mcp_audit_logs (
    user_id,
    token_id,
    tool_name,
    input,
    output_summary,
    ip_hash,
    user_agent
  )
  values (
    p_user_id,
    p_token_id,
    p_tool_name,
    p_input,
    p_output_summary,
    p_ip_hash,
    p_user_agent
  )
$$;

grant execute on function app.mcp_oauth_create_token(uuid, text, text, text, text, text, text[], timestamptz) to authenticated;
grant execute on function app.mcp_oauth_find_by_access_token_hash(text) to authenticated;
grant execute on function app.mcp_oauth_find_by_refresh_token_hash(text) to authenticated;
grant execute on function app.mcp_oauth_revoke_by_token_hash(text) to authenticated;
grant execute on function app.mcp_oauth_touch_last_used(uuid) to authenticated;
grant execute on function app.mcp_audit_create_log(uuid, uuid, text, jsonb, jsonb, text, text) to authenticated;
