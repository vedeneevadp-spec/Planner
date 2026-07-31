create table if not exists app.user_backup_restore_operations (
  id uuid primary key default app.uuid_generate_v7(),
  workspace_id uuid not null references app.workspaces(id) on delete cascade,
  user_id uuid not null references app.users(id) on delete cascade,
  idempotency_key text not null,
  archive_sha256 text not null,
  status text not null default 'applying',
  response jsonb,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  constraint user_backup_restore_operations_idempotency_key_length
    check (length(idempotency_key) between 16 and 128),
  constraint user_backup_restore_operations_archive_sha256
    check (archive_sha256 ~ '^[0-9a-f]{64}$'),
  constraint user_backup_restore_operations_status
    check (status in ('applying', 'completed')),
  constraint user_backup_restore_operations_scope_key
    unique (workspace_id, user_id, idempotency_key)
);

create index if not exists user_backup_restore_operations_user_created_idx
  on app.user_backup_restore_operations (user_id, created_at desc);

grant select, insert, update on table app.user_backup_restore_operations to authenticated;

alter table app.user_backup_restore_operations enable row level security;

drop policy if exists user_backup_restore_operations_select_self
  on app.user_backup_restore_operations;
create policy user_backup_restore_operations_select_self
on app.user_backup_restore_operations
for select
to authenticated
using (
  user_id = (select app.current_user_id())
  and exists (
    select 1
    from app.workspaces
    where workspaces.id = user_backup_restore_operations.workspace_id
      and workspaces.owner_user_id = (select app.current_user_id())
      and workspaces.kind = 'personal'
      and workspaces.deleted_at is null
  )
);

drop policy if exists user_backup_restore_operations_insert_self
  on app.user_backup_restore_operations;
create policy user_backup_restore_operations_insert_self
on app.user_backup_restore_operations
for insert
to authenticated
with check (
  user_id = (select app.current_user_id())
  and status = 'applying'
  and response is null
  and completed_at is null
  and exists (
    select 1
    from app.workspaces
    where workspaces.id = user_backup_restore_operations.workspace_id
      and workspaces.owner_user_id = (select app.current_user_id())
      and workspaces.kind = 'personal'
      and workspaces.deleted_at is null
  )
);

drop policy if exists user_backup_restore_operations_update_self
  on app.user_backup_restore_operations;
create policy user_backup_restore_operations_update_self
on app.user_backup_restore_operations
for update
to authenticated
using (
  user_id = (select app.current_user_id())
)
with check (
  user_id = (select app.current_user_id())
  and status = 'completed'
  and response is not null
  and completed_at is not null
);

comment on table app.user_backup_restore_operations is
  'Idempotency and audit metadata for completed same-scope user backup restores. Raw archives are not stored.';
