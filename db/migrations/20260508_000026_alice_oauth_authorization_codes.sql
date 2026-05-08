-- noinspection SqlNoDataSourceInspection
create table if not exists app.oauth_authorization_codes (
  id uuid primary key default app.uuid_generate_v7(),
  user_id uuid not null references app.users(id) on delete cascade,
  code_hash text not null unique,
  client_id text not null,
  redirect_uri text not null,
  scope text not null default '',
  expires_at timestamptz not null,
  consumed_at timestamptz,
  created_at timestamptz not null default now(),
  user_agent text,
  ip_address text
);

create index if not exists oauth_authorization_codes_active_idx
  on app.oauth_authorization_codes (code_hash, expires_at)
  where consumed_at is null;

create index if not exists oauth_authorization_codes_user_idx
  on app.oauth_authorization_codes (user_id, created_at desc);

alter table app.oauth_authorization_codes enable row level security;
