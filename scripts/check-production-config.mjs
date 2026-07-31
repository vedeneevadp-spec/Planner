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
  /npm run backup:alert -- %i/,
  'Backup failures must use the project alert command.',
)
assert.match(
  backupService,
  /^Environment=BACKUP_REQUIRE_OFFSITE=1$/m,
  'Scheduled backups must require offsite storage.',
)
assert.match(
  backupService,
  /^OnFailure=planner-backup-alert@%n\.service$/m,
  'Scheduled backup failures must trigger an alert.',
)
assert.match(
  backupService,
  /flock -w 300 .*backup\.lock .*npm run backup:create/,
  'Scheduled backups must use the shared backup lock.',
)
assert.match(
  backupTimer,
  /^Persistent=true$/m,
  'The daily backup timer must catch up after downtime.',
)
assert.match(
  backupPruneService,
  /npm run backup:prune/,
  'Backup retention must have a scheduled command.',
)
assert.match(
  restoreDrillService,
  /npm run backup:restore-drill/,
  'Restore drills must have a scheduled command.',
)
assert.match(backupEnvironmentExample, /^RESTIC_REPOSITORY=/m)
assert.match(backupEnvironmentExample, /^RESTIC_PASSWORD_FILE=/m)
assert.match(backupEnvironmentExample, /^BACKUP_ALERT_WEBHOOK_URL=/m)
assert.match(backupEnvironmentExample, /^BACKUP_ALERT_TELEGRAM_BOT_TOKEN=/m)
assert.match(backupEnvironmentExample, /^BACKUP_ALERT_TELEGRAM_CHAT_ID=/m)
assert.match(backupEnvironmentExample, /^RESTORE_DRILL_ADMIN_DATABASE_URL=/m)
assert.match(
  productionEnvironmentExample,
  /^USER_BACKUP_RESTORE_DATABASE_URL=/m,
  'Production config must document the isolated user backup restore connection.',
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
  /npm run backup:restore-db:check/,
  'Production deploy must probe the privileged restore database before switch.',
)

console.log('Production configuration check passed.')
