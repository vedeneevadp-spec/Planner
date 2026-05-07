-- noinspection SqlNoDataSourceInspection
do $$
begin
  if not exists (
    select 1
    from pg_type
    where typnamespace = 'app'::regnamespace
      and typname = 'emoji_set_status'
  ) then
    create type app.emoji_set_status as enum ('active', 'archived');
  end if;

  if not exists (
    select 1
    from pg_type
    where typnamespace = 'app'::regnamespace
      and typname = 'emoji_set_source'
  ) then
    create type app.emoji_set_source as enum ('custom');
  end if;

  if not exists (
    select 1
    from pg_type
    where typnamespace = 'app'::regnamespace
      and typname = 'emoji_asset_kind'
  ) then
    create type app.emoji_asset_kind as enum ('image');
  end if;
end
$$;

create table if not exists app.emoji_sets (
  id uuid primary key default app.uuid_generate_v7(),
  workspace_id uuid not null references app.workspaces(id) on delete cascade,
  title text not null,
  slug text not null,
  description text not null default '',
  source app.emoji_set_source not null default 'custom',
  status app.emoji_set_status not null default 'active',
  metadata jsonb not null default '{}'::jsonb,
  created_by uuid references app.users(id),
  updated_by uuid references app.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  version bigint not null default 1,
  unique (workspace_id, slug)
);

create table if not exists app.emoji_assets (
  id uuid primary key default app.uuid_generate_v7(),
  workspace_id uuid not null references app.workspaces(id) on delete cascade,
  emoji_set_id uuid not null references app.emoji_sets(id) on delete cascade,
  shortcode text not null,
  label text not null,
  kind app.emoji_asset_kind not null,
  value text not null,
  keywords text[] not null default '{}'::text[],
  sort_order integer not null default 0,
  metadata jsonb not null default '{}'::jsonb,
  created_by uuid references app.users(id),
  updated_by uuid references app.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  version bigint not null default 1,
  unique (emoji_set_id, shortcode)
);

create index if not exists emoji_sets_workspace_idx
  on app.emoji_sets (workspace_id, status, title);

create index if not exists emoji_assets_set_idx
  on app.emoji_assets (emoji_set_id, sort_order, label);

create index if not exists emoji_assets_workspace_shortcode_idx
  on app.emoji_assets (workspace_id, shortcode)
  where deleted_at is null;

drop trigger if exists emoji_sets_bump_row_version on app.emoji_sets;
create trigger emoji_sets_bump_row_version
before update on app.emoji_sets
for each row execute function app.bump_row_version();

drop trigger if exists emoji_assets_bump_row_version on app.emoji_assets;
create trigger emoji_assets_bump_row_version
before update on app.emoji_assets
for each row execute function app.bump_row_version();

create or replace function app.workspace_has_admin_access(target_workspace_id uuid)
returns boolean
language sql
stable
as $$
  select exists (
    select 1
    from app.workspace_members as membership
    where membership.workspace_id = target_workspace_id
      and membership.user_id = (select app.current_user_id())
      and membership.role in ('owner', 'admin')
      and membership.deleted_at is null
  )
$$;

grant select, insert, update, delete on table app.emoji_sets to authenticated;
grant select, insert, update, delete on table app.emoji_assets to authenticated;

alter table app.emoji_sets enable row level security;
alter table app.emoji_assets enable row level security;

drop policy if exists emoji_sets_select_member on app.emoji_sets;
create policy emoji_sets_select_member
on app.emoji_sets
for select
to authenticated
using (
  (select app.workspace_is_accessible(workspace_id))
  and deleted_at is null
);

drop policy if exists emoji_sets_insert_admin on app.emoji_sets;
create policy emoji_sets_insert_admin
on app.emoji_sets
for insert
to authenticated
with check (
  (select app.workspace_has_admin_access(workspace_id))
  and created_by = (select app.current_user_id())
  and updated_by = (select app.current_user_id())
);

drop policy if exists emoji_sets_update_admin on app.emoji_sets;
create policy emoji_sets_update_admin
on app.emoji_sets
for update
to authenticated
using (
  (select app.workspace_has_admin_access(workspace_id))
)
with check (
  (select app.workspace_has_admin_access(workspace_id))
  and updated_by = (select app.current_user_id())
);

drop policy if exists emoji_sets_delete_admin on app.emoji_sets;
create policy emoji_sets_delete_admin
on app.emoji_sets
for delete
to authenticated
using (
  (select app.workspace_has_admin_access(workspace_id))
);

drop policy if exists emoji_assets_select_member on app.emoji_assets;
create policy emoji_assets_select_member
on app.emoji_assets
for select
to authenticated
using (
  (select app.workspace_is_accessible(workspace_id))
  and deleted_at is null
);

drop policy if exists emoji_assets_insert_admin on app.emoji_assets;
create policy emoji_assets_insert_admin
on app.emoji_assets
for insert
to authenticated
with check (
  (select app.workspace_has_admin_access(workspace_id))
  and created_by = (select app.current_user_id())
  and updated_by = (select app.current_user_id())
);

drop policy if exists emoji_assets_update_admin on app.emoji_assets;
create policy emoji_assets_update_admin
on app.emoji_assets
for update
to authenticated
using (
  (select app.workspace_has_admin_access(workspace_id))
)
with check (
  (select app.workspace_has_admin_access(workspace_id))
  and updated_by = (select app.current_user_id())
);

drop policy if exists emoji_assets_delete_admin on app.emoji_assets;
create policy emoji_assets_delete_admin
on app.emoji_assets
for delete
to authenticated
using (
  (select app.workspace_has_admin_access(workspace_id))
);
