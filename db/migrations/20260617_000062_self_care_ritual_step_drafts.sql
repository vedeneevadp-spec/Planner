-- noinspection SqlNoDataSourceInspection
create table if not exists app.self_care_ritual_step_drafts (
  id uuid primary key default app.uuid_generate_v7(),
  workspace_id uuid not null references app.workspaces(id) on delete cascade,
  user_id uuid not null references app.users(id) on delete cascade,
  item_id uuid not null references app.self_care_items(id) on delete cascade,
  occurrence_id uuid references app.self_care_occurrences(id) on delete cascade,
  date date not null,
  step_ids uuid[] not null default array[]::uuid[],
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists self_care_ritual_step_drafts_occurrence_idx
  on app.self_care_ritual_step_drafts (user_id, date, item_id, occurrence_id)
  where occurrence_id is not null;

create unique index if not exists self_care_ritual_step_drafts_item_idx
  on app.self_care_ritual_step_drafts (user_id, date, item_id)
  where occurrence_id is null;

create index if not exists self_care_ritual_step_drafts_user_date_idx
  on app.self_care_ritual_step_drafts (user_id, date);

grant select, insert, update, delete on table
  app.self_care_ritual_step_drafts
  to authenticated;

alter table app.self_care_ritual_step_drafts enable row level security;

drop policy if exists self_care_ritual_step_drafts_private
  on app.self_care_ritual_step_drafts;

create policy self_care_ritual_step_drafts_private
  on app.self_care_ritual_step_drafts
  for all
  to authenticated
  using (
    user_id = (select app.current_user_id())
    and (select app.workspace_is_accessible(workspace_id))
    and exists (
      select 1
      from app.self_care_items item
      where item.id = item_id
        and item.workspace_id = workspace_id
        and item.user_id = (select app.current_user_id())
        and item.deleted_at is null
    )
  )
  with check (
    user_id = (select app.current_user_id())
    and (select app.workspace_has_write_access(workspace_id))
    and exists (
      select 1
      from app.self_care_items item
      where item.id = item_id
        and item.workspace_id = workspace_id
        and item.user_id = (select app.current_user_id())
        and item.deleted_at is null
    )
  );
