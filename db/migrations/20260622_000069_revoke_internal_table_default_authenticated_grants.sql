-- noinspection SqlNoDataSourceInspection
revoke all privileges on table
  app.device_sessions,
  app.outbox,
  app.schema_migrations,
  app.sync_cursors
from authenticated;

do $$
begin
  execute format(
    'alter default privileges for role %I in schema app revoke all privileges on tables from authenticated',
    current_user
  );
end
$$;
