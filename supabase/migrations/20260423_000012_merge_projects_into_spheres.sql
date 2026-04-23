-- noinspection SqlNoDataSourceInspection
do $$
declare
  constraint_name text;
begin
  for constraint_name in
    select constraint_record.conname
    from pg_constraint constraint_record
    join pg_attribute attribute_record
      on attribute_record.attrelid = constraint_record.conrelid
      and attribute_record.attname = 'sphere_id'
    where constraint_record.conrelid = 'app.tasks'::regclass
      and constraint_record.contype = 'f'
      and constraint_record.conkey = array[attribute_record.attnum]::smallint[]
  loop
    execute format('alter table app.tasks drop constraint %I', constraint_name);
  end loop;

  for constraint_name in
    select constraint_record.conname
    from pg_constraint constraint_record
    join pg_attribute attribute_record
      on attribute_record.attrelid = constraint_record.conrelid
      and attribute_record.attname = 'sphere_id'
    where constraint_record.conrelid = 'app.chaos_inbox_items'::regclass
      and constraint_record.contype = 'f'
      and constraint_record.conkey = array[attribute_record.attnum]::smallint[]
  loop
    execute format(
      'alter table app.chaos_inbox_items drop constraint %I',
      constraint_name
    );
  end loop;
end $$;

update app.tasks as task
set project_id = task.sphere_id
where task.project_id is null
  and task.sphere_id is not null
  and exists (
    select 1
    from app.projects as project
    where project.id = task.sphere_id
      and project.workspace_id = task.workspace_id
      and project.deleted_at is null
  );

update app.tasks as task
set sphere_id = task.project_id
where task.project_id is not null
  and task.sphere_id is distinct from task.project_id;

update app.tasks as task
set sphere_id = null
where task.sphere_id is not null
  and not exists (
    select 1
    from app.projects as project
    where project.id = task.sphere_id
      and project.workspace_id = task.workspace_id
      and project.deleted_at is null
  );

update app.chaos_inbox_items as item
set sphere_id = null
where item.sphere_id is not null
  and not exists (
    select 1
    from app.projects as project
    where project.id = item.sphere_id
      and project.workspace_id = item.workspace_id
      and project.deleted_at is null
  );

update app.life_spheres
set
  deleted_at = coalesce(deleted_at, now()),
  is_active = false
where deleted_at is null;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'app.tasks'::regclass
      and conname = 'tasks_sphere_id_projects_fkey'
  ) then
    alter table app.tasks
      add constraint tasks_sphere_id_projects_fkey
      foreign key (sphere_id) references app.projects(id) on delete set null;
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'app.chaos_inbox_items'::regclass
      and conname = 'chaos_inbox_items_sphere_id_projects_fkey'
  ) then
    alter table app.chaos_inbox_items
      add constraint chaos_inbox_items_sphere_id_projects_fkey
      foreign key (sphere_id) references app.projects(id) on delete set null;
  end if;
end $$;
