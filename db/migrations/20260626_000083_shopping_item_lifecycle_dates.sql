-- noinspection SqlNoDataSourceInspection
alter table app.chaos_inbox_items
  add column if not exists activated_at timestamptz,
  add column if not exists completed_at timestamptz;

update app.chaos_inbox_items
set activated_at = created_at
where kind = 'shopping'
  and activated_at is null;

update app.chaos_inbox_items
set completed_at = updated_at
where kind = 'shopping'
  and status in ('archived', 'converted')
  and completed_at is null;
