-- noinspection SqlNoDataSourceInspection
revoke all privileges on table
  app.device_sessions,
  app.outbox,
  app.schema_migrations,
  app.sync_cursors
from authenticated;

revoke all privileges on table
  app.device_sessions,
  app.outbox,
  app.schema_migrations,
  app.sync_cursors
from public;

do $$
begin
  execute format(
    'alter default privileges for role %I in schema app revoke all privileges on tables from authenticated',
    current_user
  );

  execute format(
    'alter default privileges for role %I in schema app revoke all privileges on tables from public',
    current_user
  );
end
$$;
