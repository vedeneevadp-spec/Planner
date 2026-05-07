-- noinspection SqlNoDataSourceInspection
create table if not exists app.workspace_invitations (
  id uuid primary key default app.uuid_generate_v7(),
  workspace_id uuid not null references app.workspaces(id) on delete cascade,
  email citext not null,
  role app.workspace_role not null,
  invited_by uuid references app.users(id),
  accepted_by uuid references app.users(id),
  accepted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  version bigint not null default 1,
  constraint workspace_invitations_role_assignable_check
    check (role in ('admin', 'user', 'guest')),
  unique (workspace_id, email)
);

create index if not exists workspace_invitations_workspace_idx
  on app.workspace_invitations (workspace_id, created_at)
  where deleted_at is null;

create index if not exists workspace_invitations_email_idx
  on app.workspace_invitations (email)
  where deleted_at is null and accepted_at is null;

create trigger workspace_invitations_bump_row_version
before update on app.workspace_invitations
for each row execute function app.bump_row_version();
