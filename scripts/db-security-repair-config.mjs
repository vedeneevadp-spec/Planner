// These tables are internal implementation details. Runtime requests reach
// them only through SECURITY DEFINER functions, while maintenance paths use an
// owner connection. The authenticated/public roles must never keep direct
// table privileges, even when PostgreSQL default grants drift.
export const internalAppTables = Object.freeze([
  'cleaning_operations',
  'device_sessions',
  'rate_limit_buckets',
  'schema_migrations',
  'self_care_command_ledger',
  'sync_cursors',
])

// The provider can reapply broad database privileges after migrations. These
// roles must never retain EXECUTE on application functions: PUBLIC is the
// PostgreSQL default, while planner_backup is the read-only logical-backup
// login configured for production.
export const restrictedAppFunctionRoles = Object.freeze([
  'planner_backup',
  'public',
])
