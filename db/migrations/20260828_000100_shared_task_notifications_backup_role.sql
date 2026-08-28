-- shared_task_notifications was created after the isolated planner_backup role
-- had been granted access to the existing app relations. Keep the internal
-- queue readable by logical backups without exposing any write capability.

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'planner_backup') then
    revoke insert, update, delete, truncate, references, trigger
      on table app.shared_task_notifications
      from planner_backup;
    grant select on table app.shared_task_notifications to planner_backup;
  end if;
end;
$$;
