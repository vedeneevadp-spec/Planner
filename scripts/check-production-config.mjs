import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const [
  caddyfile,
  backupService,
  backupAlertService,
  backupTimer,
  backupPruneService,
  restoreDrillService,
  backupEnvironmentExample,
  productionEnvironmentExample,
  deploySource,
  apiService,
  remindersService,
  restoreHelperService,
  infrastructureBackupSource,
  backupDatabaseCheckSource,
  backupReadRoleMigration,
] = await Promise.all([
  readFile(new URL('../deploy/caddy/Caddyfile', import.meta.url), 'utf8'),
  readFile(
    new URL('../deploy/systemd/planner-backup.service', import.meta.url),
    'utf8',
  ),
  readFile(
    new URL('../deploy/systemd/planner-backup-alert@.service', import.meta.url),
    'utf8',
  ),
  readFile(
    new URL('../deploy/systemd/planner-backup.timer', import.meta.url),
    'utf8',
  ),
  readFile(
    new URL('../deploy/systemd/planner-backup-prune.service', import.meta.url),
    'utf8',
  ),
  readFile(
    new URL('../deploy/systemd/planner-restore-drill.service', import.meta.url),
    'utf8',
  ),
  readFile(new URL('../deploy/backup.env.example', import.meta.url), 'utf8'),
  readFile(new URL('../.env.production.example', import.meta.url), 'utf8'),
  readFile(new URL('./deploy-prod.mjs', import.meta.url), 'utf8'),
  readFile(
    new URL('../deploy/systemd/planner-api.service', import.meta.url),
    'utf8',
  ),
  readFile(
    new URL(
      '../deploy/systemd/planner-task-reminders.service',
      import.meta.url,
    ),
    'utf8',
  ),
  readFile(
    new URL(
      '../deploy/systemd/planner-user-backup-restore.service',
      import.meta.url,
    ),
    'utf8',
  ),
  readFile(
    new URL('./infrastructure-backup-create.mjs', import.meta.url),
    'utf8',
  ),
  readFile(new URL('./check-backup-database.mjs', import.meta.url), 'utf8'),
  readFile(
    new URL(
      '../db/migrations/20260813_000096_backup_read_role.sql',
      import.meta.url,
    ),
    'utf8',
  ),
])

const permissionsPolicy = caddyfile.match(/Permissions-Policy\s+"([^"]+)"/)?.[1]

assert.ok(permissionsPolicy, 'Caddyfile must define Permissions-Policy.')
assert.match(
  permissionsPolicy,
  /(?:^|,\s*)microphone=\(self\)(?:,|$)/,
  'Production web voice requires microphone access for the current origin.',
)
assert.match(
  permissionsPolicy,
  /(?:^|,\s*)camera=\(\)(?:,|$)/,
  'Camera access must remain disabled.',
)
assert.match(
  permissionsPolicy,
  /(?:^|,\s*)geolocation=\(\)(?:,|$)/,
  'Geolocation access must remain disabled.',
)

assert.match(
  backupService,
  /^Environment=BACKUP_REQUIRE_ASSETS=1$/m,
  'Scheduled backups must fail when the production asset directory is absent.',
)
assert.match(
  backupAlertService,
  /infrastructure-backup-alert\.mjs %i/,
  'Backup failures must use the project alert command.',
)
assert.match(backupAlertService, /^User=planner-alert$/m)
assert.doesNotMatch(backupAlertService, /backup-runtime\.env/)
assert.doesNotMatch(backupAlertService, /backup-job\.env/)
assert.match(
  backupService,
  /^Environment=BACKUP_REQUIRE_OFFSITE=1$/m,
  'Scheduled backups must require offsite storage.',
)
assert.match(backupService, /^User=planner-backup$/m)
assert.match(
  backupService,
  /^EnvironmentFile=\/etc\/planner\/backup-job\.env$/m,
)
assert.doesNotMatch(backupService, /planner\.env/)
assert.match(
  backupService,
  /^OnFailure=planner-backup-alert@%n\.service$/m,
  'Scheduled backup failures must trigger an alert.',
)
assert.match(
  backupService,
  /flock -w 300 .*backup\.lock .*infrastructure-backup-create\.mjs/,
  'Scheduled backups must use the shared backup lock.',
)
assert.match(
  backupTimer,
  /^Persistent=true$/m,
  'The daily backup timer must catch up after downtime.',
)
assert.match(
  backupPruneService,
  /infrastructure-backup-prune\.mjs/,
  'Backup retention must have a scheduled command.',
)
assert.match(
  restoreDrillService,
  /infrastructure-restore-drill\.mjs/,
  'Restore drills must have a scheduled command.',
)
assert.match(backupEnvironmentExample, /^RESTIC_REPOSITORY=/m)
assert.match(backupEnvironmentExample, /^RESTIC_PASSWORD_FILE=/m)
assert.match(backupEnvironmentExample, /^BACKUP_ALERT_WEBHOOK_URL=/m)
assert.match(backupEnvironmentExample, /^BACKUP_ALERT_TELEGRAM_BOT_TOKEN=/m)
assert.match(backupEnvironmentExample, /^BACKUP_ALERT_TELEGRAM_CHAT_ID=/m)
assert.match(backupEnvironmentExample, /^BACKUP_ALERT_EMAIL_TO=/m)
assert.match(backupEnvironmentExample, /^BACKUP_DATABASE_URL=/m)
assert.match(backupEnvironmentExample, /^RESTORE_DRILL_ADMIN_DATABASE_URL=/m)
assert.match(infrastructureBackupSource, /--enable-row-security/)
assert.match(backupDatabaseCheckSource, /pg_export_snapshot/)
assert.match(backupDatabaseCheckSource, /has_function_privilege/)
assert.match(backupReadRoleMigration, /planner_backup_select_all/)
assert.match(backupReadRoleMigration, /session_user = %L/)
assert.match(backupReadRoleMigration, /from planner_backup/)
assert.match(
  productionEnvironmentExample,
  /^USER_BACKUP_RESTORE_DATABASE_URL=/m,
  'Production config must document the isolated user backup restore connection.',
)
assert.match(
  productionEnvironmentExample,
  /^USER_BACKUP_RESTORE_HELPER_SECRET=/m,
  'Production config must document the restore helper authentication secret.',
)
assert.match(
  productionEnvironmentExample,
  /^USER_BACKUP_RESTORE_HELPER_URL=http:\/\/127\.0\.0\.1:3012\/internal\/user-backup\/restore$/m,
  'Production config must keep the restore helper on its managed loopback endpoint.',
)
assert.match(
  productionEnvironmentExample,
  /^DATABASE_URL=.*[?&]sslmode=require(?:&|$)/m,
  'Production config must require TLS for PostgreSQL.',
)
assert.match(
  deploySource,
  /USER_BACKUP_RESTORE_DATABASE_URL must be configured/,
  'Production deploy must require the user backup restore connection.',
)
assert.match(
  deploySource,
  /USER_BACKUP_RESTORE_DATABASE_URL must not reuse the runtime DATABASE_URL/,
  'Production deploy must keep privileged restore separate from runtime RLS.',
)
assert.match(
  deploySource,
  /BACKUP_DATABASE_URL is required/,
  'Scheduled backups must use a dedicated database URL instead of inheriting migration credentials.',
)
assert.match(
  deploySource,
  /node scripts\/check-user-backup-restore-database\.mjs/,
  'Production deploy must probe the privileged restore database before switch.',
)
assert.match(
  deploySource,
  /node scripts\/check-backup-database\.mjs/,
  'Production deploy must verify read-only backup visibility before switch.',
)
assert.match(apiService, /^User=planner-api$/m)
assert.match(apiService, /^EnvironmentFile=\/etc\/planner\/api\.env$/m)
assert.match(apiService, /^ProtectSystem=strict$/m)
assert.doesNotMatch(apiService, /planner\.env/)
assert.match(remindersService, /^User=planner-worker$/m)
assert.match(
  remindersService,
  /^EnvironmentFile=\/etc\/planner\/reminders\.env$/m,
)
assert.doesNotMatch(remindersService, /planner\.env/)
assert.match(restoreHelperService, /^User=planner-restore$/m)
assert.match(
  restoreHelperService,
  /^EnvironmentFile=\/etc\/planner\/restore-helper\.env$/m,
)
assert.match(deploySource, /npm prune --omit=dev --ignore-scripts/)
assert.match(deploySource, /chown -R root:root "\$release_dir"/)
assert.match(
  deploySource,
  /DATABASE_URL must require TLS for remote PostgreSQL/,
  'Production deploy must reject insecure remote PostgreSQL connections.',
)

console.log('Production configuration check passed.')
