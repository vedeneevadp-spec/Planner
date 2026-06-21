-- noinspection SqlNoDataSourceInspection
revoke all privileges on table
  app.device_sessions,
  app.outbox,
  app.schema_migrations,
  app.sync_cursors
from authenticated;
