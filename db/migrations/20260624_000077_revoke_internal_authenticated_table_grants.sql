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
declare
  owner_name text;
begin
  for owner_name in
    select distinct pg_get_userbyid(pg_class.relowner)
    from pg_class
    join pg_namespace on pg_namespace.oid = pg_class.relnamespace
    where pg_namespace.nspname = 'app'
      and pg_class.relname in (
        'device_sessions',
        'outbox',
        'schema_migrations',
        'sync_cursors'
      )
  loop
    execute format(
      'alter default privileges for role %I in schema app revoke all privileges on tables from authenticated',
      owner_name
    );

    execute format(
      'alter default privileges for role %I in schema app revoke all privileges on tables from public',
      owner_name
    );
  end loop;
end
$$;
