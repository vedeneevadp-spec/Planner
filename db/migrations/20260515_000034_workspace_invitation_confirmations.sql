-- noinspection SqlNoDataSourceInspection
alter table app.workspace_invitations
  add column if not exists declined_by uuid references app.users(id),
  add column if not exists declined_at timestamptz;

create index if not exists workspace_invitations_pending_email_idx
  on app.workspace_invitations (email, created_at)
  where deleted_at is null
    and accepted_at is null
    and declined_at is null;
