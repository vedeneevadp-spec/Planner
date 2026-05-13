-- noinspection SqlNoDataSourceInspection
alter table app.auth_refresh_tokens
  add column if not exists rotated_at timestamptz,
  add column if not exists replaced_by_token_id uuid references app.auth_refresh_tokens(id) on delete set null;

create index if not exists auth_refresh_tokens_session_idx
  on app.auth_refresh_tokens (session_id, created_at desc);

create unique index if not exists auth_refresh_tokens_active_session_idx
  on app.auth_refresh_tokens (session_id)
  where revoked_at is null and rotated_at is null;

create index if not exists auth_refresh_tokens_replaced_by_idx
  on app.auth_refresh_tokens (replaced_by_token_id)
  where replaced_by_token_id is not null;
