-- noinspection SqlNoDataSourceInspection
alter table app.cleaning_tasks
  add column if not exists scope text;

update app.cleaning_tasks
set scope = 'zone'
where scope is null;

alter table app.cleaning_tasks
  alter column scope set default 'zone',
  alter column scope set not null,
  alter column zone_id drop not null;

alter table app.cleaning_task_history
  alter column zone_id drop not null;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where connamespace = 'app'::regnamespace
      and conname = 'cleaning_tasks_scope_valid'
  ) then
    alter table app.cleaning_tasks
      add constraint cleaning_tasks_scope_valid
      check (scope in ('zone', 'general'));
  end if;

  if not exists (
    select 1
    from pg_constraint
    where connamespace = 'app'::regnamespace
      and conname = 'cleaning_tasks_scope_zone_consistent'
  ) then
    alter table app.cleaning_tasks
      add constraint cleaning_tasks_scope_zone_consistent
      check (
        (scope = 'zone' and zone_id is not null)
        or
        (scope = 'general' and zone_id is null)
      );
  end if;
end $$;

create index if not exists cleaning_tasks_workspace_general_idx
  on app.cleaning_tasks (workspace_id, is_active, sort_order, title)
  where deleted_at is null and scope = 'general';
