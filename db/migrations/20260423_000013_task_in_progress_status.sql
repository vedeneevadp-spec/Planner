alter type app.task_status add value if not exists 'in_progress';

alter table app.tasks drop constraint if exists tasks_resource_range;

update app.tasks
set resource = -resource
where resource > 0;

alter table app.tasks
  add constraint tasks_resource_range
  check (resource is null or resource between -5 and 5)
  not valid;

alter table app.tasks validate constraint tasks_resource_range;
