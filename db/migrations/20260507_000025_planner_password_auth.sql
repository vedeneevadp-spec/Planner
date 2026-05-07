-- noinspection SqlNoDataSourceInspection
create table if not exists app.auth_credentials (
  user_id uuid primary key references app.users(id) on delete cascade,
  email citext not null unique,
  password_hash text not null,
  password_updated_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  version bigint not null default 1
);

create table if not exists app.auth_refresh_tokens (
  id uuid primary key default app.uuid_generate_v7(),
  user_id uuid not null references app.users(id) on delete cascade,
  token_hash text not null unique,
  session_id uuid not null,
  expires_at timestamptz not null,
  revoked_at timestamptz,
  created_at timestamptz not null default now(),
  last_used_at timestamptz,
  user_agent text,
  ip_address text
);

create table if not exists app.auth_password_reset_tokens (
  id uuid primary key default app.uuid_generate_v7(),
  user_id uuid not null references app.users(id) on delete cascade,
  token_hash text not null unique,
  expires_at timestamptz not null,
  used_at timestamptz,
  created_at timestamptz not null default now(),
  user_agent text,
  ip_address text
);

create index if not exists auth_credentials_active_email_idx
  on app.auth_credentials (email)
  where deleted_at is null;

create index if not exists auth_refresh_tokens_active_user_idx
  on app.auth_refresh_tokens (user_id, expires_at)
  where revoked_at is null;

create index if not exists auth_password_reset_tokens_active_user_idx
  on app.auth_password_reset_tokens (user_id, expires_at)
  where used_at is null;

drop trigger if exists auth_credentials_bump_row_version
  on app.auth_credentials;
create trigger auth_credentials_bump_row_version
before update on app.auth_credentials
for each row execute function app.bump_row_version();

alter table app.auth_credentials enable row level security;
alter table app.auth_refresh_tokens enable row level security;
alter table app.auth_password_reset_tokens enable row level security;
