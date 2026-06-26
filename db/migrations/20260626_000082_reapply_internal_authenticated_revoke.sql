-- Re-apply the internal-table authenticated revoke for production databases
-- where historical grants remained after earlier repair migrations.
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
