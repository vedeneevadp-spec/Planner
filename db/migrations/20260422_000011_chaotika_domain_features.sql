-- noinspection SqlNoDataSourceInspection
create table if not exists app.life_spheres (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references app.workspaces(id) on delete cascade,
  user_id uuid not null references app.users(id) on delete cascade,
  name text not null,
  color text,
  icon text,
  is_default boolean not null default false,
  sort_order integer not null default 0,
  is_active boolean not null default true,
  created_by uuid references app.users(id),
  updated_by uuid references app.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  version bigint not null default 1,
  unique (workspace_id, user_id, name)
);

alter table app.tasks
  add column if not exists sphere_id uuid references app.life_spheres(id) on delete set null,
  add column if not exists resource smallint,
  add constraint tasks_resource_range check (resource is null or resource between 1 and 5) not valid;

alter table app.tasks validate constraint tasks_resource_range;

create table if not exists app.chaos_inbox_items (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references app.workspaces(id) on delete cascade,
  user_id uuid not null references app.users(id) on delete cascade,
  text text not null,
  source text not null default 'manual',
  status text not null default 'new',
  kind text not null default 'unknown',
  sphere_id uuid references app.life_spheres(id) on delete set null,
  priority text,
  due_on date,
  converted_task_id uuid references app.tasks(id) on delete set null,
  converted_note_id uuid,
  created_by uuid references app.users(id),
  updated_by uuid references app.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  version bigint not null default 1,
  constraint chaos_inbox_text_length check (char_length(trim(text)) between 1 and 5000),
  constraint chaos_inbox_source_check check (source in ('manual', 'quick_add', 'widget', 'voice')),
  constraint chaos_inbox_status_check check (status in ('new', 'in_review', 'converted', 'archived')),
  constraint chaos_inbox_kind_check check (kind in ('unknown', 'task', 'note', 'shopping', 'event', 'idea')),
  constraint chaos_inbox_priority_check check (priority is null or priority in ('low', 'medium', 'high'))
);

create table if not exists app.daily_plans (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references app.workspaces(id) on delete cascade,
  user_id uuid not null references app.users(id) on delete cascade,
  date date not null,
  energy_mode text not null default 'normal',
  focus_task_ids uuid[] not null default '{}'::uuid[],
  support_task_ids uuid[] not null default '{}'::uuid[],
  routine_task_ids uuid[] not null default '{}'::uuid[],
  overload_score integer not null default 0,
  created_by uuid references app.users(id),
  updated_by uuid references app.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  version bigint not null default 1,
  unique (workspace_id, user_id, date),
  constraint daily_plans_energy_mode_check check (energy_mode in ('minimum', 'normal', 'maximum')),
  constraint daily_plans_overload_score_check check (overload_score >= 0)
);

create index if not exists life_spheres_workspace_active_idx
  on app.life_spheres (workspace_id, user_id, is_active, sort_order)
  where deleted_at is null;

create index if not exists tasks_workspace_sphere_idx
  on app.tasks (workspace_id, sphere_id, planned_on, created_at)
  where deleted_at is null;

create index if not exists chaos_inbox_workspace_status_idx
  on app.chaos_inbox_items (workspace_id, user_id, status, created_at)
  where deleted_at is null;

create index if not exists chaos_inbox_workspace_kind_idx
  on app.chaos_inbox_items (workspace_id, user_id, kind, created_at)
  where deleted_at is null;

create index if not exists daily_plans_workspace_user_date_idx
  on app.daily_plans (workspace_id, user_id, date)
  where deleted_at is null;

drop trigger if exists life_spheres_bump_row_version on app.life_spheres;
create trigger life_spheres_bump_row_version
before update on app.life_spheres
for each row execute function app.bump_row_version();

drop trigger if exists chaos_inbox_items_bump_row_version on app.chaos_inbox_items;
create trigger chaos_inbox_items_bump_row_version
before update on app.chaos_inbox_items
for each row execute function app.bump_row_version();

drop trigger if exists daily_plans_bump_row_version on app.daily_plans;
create trigger daily_plans_bump_row_version
before update on app.daily_plans
for each row execute function app.bump_row_version();

grant select, insert, update, delete on table app.life_spheres to authenticated;
grant select, insert, update, delete on table app.chaos_inbox_items to authenticated;
grant select, insert, update, delete on table app.daily_plans to authenticated;

alter table app.life_spheres enable row level security;
alter table app.chaos_inbox_items enable row level security;
alter table app.daily_plans enable row level security;

drop policy if exists life_spheres_select_member on app.life_spheres;
create policy life_spheres_select_member
on app.life_spheres
for select
to authenticated
using (
  (select app.workspace_is_accessible(workspace_id))
  and deleted_at is null
);

drop policy if exists life_spheres_insert_member on app.life_spheres;
create policy life_spheres_insert_member
on app.life_spheres
for insert
to authenticated
with check (
  (select app.workspace_is_accessible(workspace_id))
  and user_id = (select app.current_user_id())
  and created_by = (select app.current_user_id())
  and updated_by = (select app.current_user_id())
);

drop policy if exists life_spheres_update_member on app.life_spheres;
create policy life_spheres_update_member
on app.life_spheres
for update
to authenticated
using (
  (select app.workspace_is_accessible(workspace_id))
)
with check (
  (select app.workspace_is_accessible(workspace_id))
  and updated_by = (select app.current_user_id())
);

drop policy if exists life_spheres_delete_member on app.life_spheres;
create policy life_spheres_delete_member
on app.life_spheres
for delete
to authenticated
using ((select app.workspace_is_accessible(workspace_id)));

drop policy if exists chaos_inbox_items_select_member on app.chaos_inbox_items;
create policy chaos_inbox_items_select_member
on app.chaos_inbox_items
for select
to authenticated
using (
  (select app.workspace_is_accessible(workspace_id))
  and deleted_at is null
);

drop policy if exists chaos_inbox_items_insert_member on app.chaos_inbox_items;
create policy chaos_inbox_items_insert_member
on app.chaos_inbox_items
for insert
to authenticated
with check (
  (select app.workspace_is_accessible(workspace_id))
  and user_id = (select app.current_user_id())
  and created_by = (select app.current_user_id())
  and updated_by = (select app.current_user_id())
);

drop policy if exists chaos_inbox_items_update_member on app.chaos_inbox_items;
create policy chaos_inbox_items_update_member
on app.chaos_inbox_items
for update
to authenticated
using ((select app.workspace_is_accessible(workspace_id)))
with check (
  (select app.workspace_is_accessible(workspace_id))
  and updated_by = (select app.current_user_id())
);

drop policy if exists chaos_inbox_items_delete_member on app.chaos_inbox_items;
create policy chaos_inbox_items_delete_member
on app.chaos_inbox_items
for delete
to authenticated
using ((select app.workspace_is_accessible(workspace_id)));

drop policy if exists daily_plans_select_member on app.daily_plans;
create policy daily_plans_select_member
on app.daily_plans
for select
to authenticated
using (
  (select app.workspace_is_accessible(workspace_id))
  and deleted_at is null
);

drop policy if exists daily_plans_insert_member on app.daily_plans;
create policy daily_plans_insert_member
on app.daily_plans
for insert
to authenticated
with check (
  (select app.workspace_is_accessible(workspace_id))
  and user_id = (select app.current_user_id())
  and created_by = (select app.current_user_id())
  and updated_by = (select app.current_user_id())
);

drop policy if exists daily_plans_update_member on app.daily_plans;
create policy daily_plans_update_member
on app.daily_plans
for update
to authenticated
using ((select app.workspace_is_accessible(workspace_id)))
with check (
  (select app.workspace_is_accessible(workspace_id))
  and updated_by = (select app.current_user_id())
);

drop policy if exists daily_plans_delete_member on app.daily_plans;
create policy daily_plans_delete_member
on app.daily_plans
for delete
to authenticated
using ((select app.workspace_is_accessible(workspace_id)));
