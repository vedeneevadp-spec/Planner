import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { spawnSync } from 'node:child_process'
import { dirname, resolve } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

import {
  createReleaseLayout,
  parseReleaseRetention,
} from './deploy-prod-helpers.mjs'
import {
  internalAppTables,
  restrictedAppFunctionRoles,
} from './db-security-repair-config.mjs'
import {
  createRemoteDatabaseTransportValidatorScript,
  createRemoteDeployLockScript,
  createRemotePreparationScript,
  createRemoteReleaseScript,
  createRemoteSourceExtractionScript,
} from './deploy-prod.mjs'

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const commit = 'a'.repeat(40)
const layout = createReleaseLayout('/opt/planner/', commit)

test('creates an immutable release layout with shared state', () => {
  assert.deepEqual(layout, {
    backupsDirectory: '/opt/planner/shared/backups',
    currentLink: '/opt/planner/current',
    lockFile: '/opt/planner/.deploy.lock',
    releaseDirectory: `/opt/planner/releases/${commit}`,
    releaseId: commit,
    releasesRoot: '/opt/planner/releases',
    remoteRoot: '/opt/planner',
    sharedRoot: '/opt/planner/shared',
    stateDirectory: '/opt/planner/shared/state',
  })

  assert.throws(() => createReleaseLayout('/', commit), /non-root path/)
  assert.throws(() => createReleaseLayout('/opt/planner', 'abc'), /commit/)
  assert.equal(parseReleaseRetention('5'), 5)
  assert.throws(() => parseReleaseRetention('1'), /integer from 2 to 20/)
})

test('uses a fail-fast remote lock for the full deployment lifetime', () => {
  const script = createRemoteDeployLockScript(layout)

  assertBashSyntax(script)
  assert.match(script, /command -v flock/)
  assert.match(script, /flock -n 9/)
  assert.match(script, /Another production deploy is already in progress/)
  assert.match(script, /exit 75/)
  assertOrder(script, 'exec 9>"$lock_file"', 'flock -n 9')
  assertOrder(script, 'flock -n 9', '__PLANNER_DEPLOY_LOCK_ACQUIRED__')
  assertOrder(
    script,
    '__PLANNER_DEPLOY_LOCK_ACQUIRED__',
    'read -r _release_lock_signal',
  )
})

test('documents remote deploy lock behavior in command help', () => {
  const result = spawnSync(
    process.execPath,
    [resolve(repositoryRoot, 'scripts/deploy-prod.mjs'), '--help'],
    { encoding: 'utf8' },
  )

  assert.equal(result.status, 0, result.stderr)
  assert.match(result.stdout, /non-blocking remote flock/)
  assert.match(result.stdout, /concurrent deploy exits\s+immediately/)
})

test('holds the remote lock around preparation, source transfer, and release', async () => {
  const deploySource = await readFile(
    resolve(repositoryRoot, 'scripts/deploy-prod.mjs'),
    'utf8',
  )

  assertOrder(
    deploySource,
    'const remoteLock = await acquireRemoteDeployLock(layout)',
    'if (skipChecks)',
  )
  assertOrder(
    deploySource,
    'const remoteLock = await acquireRemoteDeployLock(layout)',
    'await ensureRemoteDirectories(layout, remoteLock.signal)',
  )
  assertOrder(
    deploySource,
    'await ensureRemoteDirectories(layout, remoteLock.signal)',
    'await syncProject(layout, remoteLock.signal)',
  )
  assertOrder(
    deploySource,
    'await syncProject(layout, remoteLock.signal)',
    'await runRemoteRelease(layout, remoteLock.signal)',
  )
  assertOrder(
    deploySource,
    'await runRemoteRelease(layout, remoteLock.signal)',
    'await remoteLock.release()',
  )
  assert.match(deploySource, /ConnectTimeout=10/)
  assert.match(deploySource, /ServerAliveInterval=5/)
  assert.match(deploySource, /ServerAliveCountMax=12/)
  assert.match(deploySource, /IPQoS=none/)
  assert.match(deploySource, /RSYNC_REMOTE_SHELL/)
  assert.match(deploySource, /Timed out after 15 seconds/)
  assert.match(deploySource, /signal: options\.signal/)
})

test('requires TLS for remote production PostgreSQL before deploy', () => {
  const validator = createRemoteDatabaseTransportValidatorScript()
  const acceptedUrls = [
    'postgres://planner:secret@127.0.0.1:5432/planner',
    'postgres://planner:secret@localhost:5432/planner',
    'postgresql://planner:secret@db.example.test:5432/planner?sslmode=require',
    'postgresql://planner:secret@db.example.test:5432/planner?sslmode=verify-full',
  ]
  const rejectedUrls = [
    'postgresql://planner:secret@db.example.test:5432/planner',
    'postgresql://planner:secret@127.example.test:5432/planner',
    'postgresql://planner:secret@db.example.test:5432/planner?sslmode=disable',
    'postgresql://planner:secret@db.example.test:5432/planner?sslmode=prefer',
  ]

  for (const databaseUrl of acceptedUrls) {
    const result = runDatabaseTransportValidator(validator, databaseUrl)

    assert.equal(result.status, 0, result.stderr)
  }

  for (const databaseUrl of rejectedUrls) {
    const result = runDatabaseTransportValidator(validator, databaseUrl)

    assert.equal(result.status, 1)
    assert.match(result.stderr, /DATABASE_URL must require TLS/)
    assert.doesNotMatch(result.stderr, /secret/)
  }
})

test('packages only the committed Git tree into the inactive release', async () => {
  const deploySource = await readFile(
    resolve(repositoryRoot, 'scripts/deploy-prod.mjs'),
    'utf8',
  )
  const extractionScript = createRemoteSourceExtractionScript(layout, {
    partCount: 14,
    sha256: 'a'.repeat(64),
  })

  assert.match(deploySource, /'git',[\s\S]*'archive'/)
  assert.match(deploySource, /layout\.releaseId/)
  assert.match(deploySource, /'scp'/)
  assert.match(deploySource, /SOURCE_UPLOAD_CHUNK_BYTES = 256 \* 1024/)
  assert.match(deploySource, /SOURCE_UPLOAD_ATTEMPTS = 3/)
  assert.match(deploySource, /createHash\('sha256'\)/)
  assert.doesNotMatch(deploySource, /collectTrackedProjectFiles/)
  assertBashSyntax(extractionScript)
  assert.match(extractionScript, /part_count=14/)
  assert.match(extractionScript, /sha256sum -c -/)
  assert.match(extractionScript, /\.deploy-source\.part\./)
  assert.match(extractionScript, /tar -xzf "\$archive_path"/)
  assert.match(extractionScript, /test -f "\$release_dir\/package\.json"/)
})

test('keeps the legacy production root available during first preparation', () => {
  const script = createRemotePreparationScript(layout)

  assertBashSyntax(script)
  assert.match(script, /ln -s "\$remote_root" "\$current_link"/)
  assert.match(script, /Refusing to overwrite the active release/)
  assert.doesNotMatch(script, /rm -rf "\$remote_root"/)
  assert.match(script, /ensure_system_user planner-api planner-api/)
  assert.match(script, /ensure_system_user planner-worker planner-worker/)
  assert.match(script, /ensure_system_user planner-restore planner-restore/)
  assert.match(script, /ensure_system_user planner-backup planner-backup/)
  assert.match(script, /ensure_system_user planner-alert planner-alert/)
  assert.match(
    script,
    /usermod -a -G planner-assets,planner-backup,planner-push planner/,
  )
  assert.doesNotMatch(script, /chown -R planner:planner/)
})

test('builds and migrates before the atomic switch, with post-switch rollback', () => {
  const script = createRemoteReleaseScript(layout)

  assertBashSyntax(script)
  assert.match(script, /^set -Eeuo pipefail$/m)
  assertOrder(script, 'npm run toolchain:check', 'npm ci --include=dev')
  assertOrder(script, 'npm ci --include=dev', 'npm run build')
  assertOrder(script, 'npm run build', 'npm prune --omit=dev')
  assertOrder(script, 'npm prune --omit=dev', 'node scripts/db-migrate.mjs')
  assertOrder(
    script,
    'node scripts/db-migrate.mjs',
    'node scripts/db-security-repair.mjs',
  )
  assertOrder(
    script,
    'node scripts/db-security-repair.mjs',
    'node scripts/db-security-check.mjs',
  )
  assertOrder(
    script,
    'node scripts/db-security-check.mjs',
    'atomic_switch "$release_dir"',
  )
  assertOrder(
    script,
    'node scripts/check-user-backup-restore-database.mjs',
    'atomic_switch "$release_dir"',
  )
  assertOrder(
    script,
    'node scripts/db-migrate.mjs',
    'atomic_switch "$release_dir"',
  )
  assertOrder(
    script,
    'atomic_switch "$release_dir"',
    'systemctl restart planner-api',
  )
  assertOrder(
    script,
    "wait_for_url 'https://chaotika.ru/'",
    'touch "$release_dir/.deploy-complete"',
  )
  assert.match(script, /DB_BACKUP_DIR="\$backups_dir"/)
  assert.match(script, /flock -w 300 "\$shared_state_dir\/backup\.lock"/)
  assert.match(script, /BACKUP_AUTOMATION_ENABLED_VALUE/)
  assert.match(script, /USER_BACKUP_RESTORE_DATABASE_URL/)
  assert.match(script, /USER_BACKUP_RESTORE_HELPER_SECRET/)
  assert.match(script, /USER_BACKUP_RESTORE_HELPER_URL/)
  assert.match(script, /node scripts\/check-user-backup-restore-database\.mjs/)
  assert.match(
    script,
    /USER_BACKUP_RESTORE_DATABASE_URL must not reuse the runtime DATABASE_URL/,
  )
  assert.match(script, /apply_backup_state/)
  assert.match(script, /planner-backup\.timer/)
  assert.match(script, /planner-restore-drill\.timer/)
  assert.match(script, /atomic_switch "\$previous_release"/)
  assert.match(script, /install_runtime_configs "\$previous_release"/)
  assert.match(script, /apply_restore_helper_state/)
  assert.match(script, /install_legacy_runtime_compatibility/)
  assert.match(script, /chown root:planner "\$env_file"/)
  assert.match(
    script,
    /chown -R planner:planner "\$shared_state_dir" "\$backups_dir"/,
  )
  assert.match(script, /write_env_subset \/etc\/planner\/api\.env/)
  assert.match(script, /write_env_subset \/etc\/planner\/reminders\.env/)
  assert.match(script, /write_env_subset \/etc\/planner\/restore-helper\.env/)
  assert.match(script, /write_env_subset \/etc\/planner\/backup-runtime\.env/)
  assert.match(script, /chown -R root:root "\$release_dir"/)
  assert.match(script, /test ! -e "\$release_dir\/node_modules\/tsx"/)
  assert.match(script, /chmod 0600 "\$env_file"/)

  const apiEnvBlock = extractBetween(
    script,
    'write_env_subset /etc/planner/api.env',
    'write_env_subset /etc/planner/reminders.env',
  )
  const remindersEnvBlock = extractBetween(
    script,
    'write_env_subset /etc/planner/reminders.env',
    'write_env_subset /etc/planner/restore-helper.env',
  )
  const restoreEnvBlock = extractBetween(
    script,
    'write_env_subset /etc/planner/restore-helper.env',
    'write_env_subset /etc/planner/backup-runtime.env',
  )
  const backupRuntimeEnvBlock = extractBetween(
    script,
    'write_env_subset /etc/planner/backup-runtime.env',
    'write_env_subset /etc/planner/backup-alert-runtime.env',
  )
  const backupJobEnvBlock = extractBetween(
    script,
    'write_env_subset_from "$backup_env_file" /etc/planner/backup-job.env',
    'write_env_subset_from "$backup_env_file" /etc/planner/backup-alert.env',
  )

  assert.match(apiEnvBlock, /DATABASE_URL/)
  assert.match(apiEnvBlock, /USER_BACKUP_RESTORE_HELPER_SECRET/)
  assert.doesNotMatch(apiEnvBlock, /MIGRATE_DATABASE_URL/)
  assert.doesNotMatch(apiEnvBlock, /USER_BACKUP_RESTORE_DATABASE_URL/)
  assert.doesNotMatch(apiEnvBlock, /TASK_REMINDERS_DATABASE_URL/)
  assert.match(remindersEnvBlock, /TASK_REMINDERS_DATABASE_URL/)
  assert.match(remindersEnvBlock, /SELF_CARE_REMINDERS_BATCH_SIZE/)
  assert.doesNotMatch(remindersEnvBlock, /AUTH_JWT_SECRET/)
  assert.doesNotMatch(remindersEnvBlock, /MIGRATE_DATABASE_URL/)
  assert.match(restoreEnvBlock, /USER_BACKUP_RESTORE_DATABASE_URL/)
  assert.doesNotMatch(restoreEnvBlock, /\n {4}DATABASE_URL \\/)
  assert.doesNotMatch(restoreEnvBlock, /AUTH_JWT_SECRET/)
  assert.doesNotMatch(backupRuntimeEnvBlock, /MIGRATE_DATABASE_URL/)
  assert.doesNotMatch(backupRuntimeEnvBlock, /BACKUP_DATABASE_URL/)
  assert.match(backupJobEnvBlock, /BACKUP_DATABASE_URL/)
  assert.doesNotMatch(backupJobEnvBlock, /MIGRATE_DATABASE_URL/)
  assert.match(script, /node scripts\/check-backup-database\.mjs/)
  assert.match(script, /BACKUP_DATABASE_URL="\$BACKUP_DATABASE_URL_VALUE"/)
  assert.match(script, /rm -f "\$release_dir\/\.deploy-complete"/)
  assert.match(script, /reload_caddy/)
  assert.match(script, /prune_releases/)
})

test('repairs internal table and backup function grant drift', async () => {
  assert.deepEqual(internalAppTables, [
    'cleaning_operations',
    'device_sessions',
    'rate_limit_buckets',
    'schema_migrations',
    'self_care_command_ledger',
    'sync_cursors',
  ])
  assert.deepEqual(restrictedAppFunctionRoles, ['planner_backup', 'public'])

  const repairSource = await readFile(
    resolve(repositoryRoot, 'scripts/db-security-repair.mjs'),
    'utf8',
  )

  assert.match(
    repairSource,
    /revoke execute on all functions in schema app from/,
  )
  assert.match(repairSource, /readRestrictedAppFunctionGrants/)
  assert.match(repairSource, /has_function_privilege/)
})

test('runtime services and Caddy resolve the current release symlink', async () => {
  const [
    apiUnit,
    restoreHelperUnit,
    workerUnit,
    backupUnit,
    backupTimer,
    backupPruneUnit,
    backupPruneTimer,
    restoreDrillUnit,
    restoreDrillTimer,
    caddyfile,
    deploySource,
    backupSource,
  ] = await Promise.all([
    readFile(
      resolve(repositoryRoot, 'deploy/systemd/planner-api.service'),
      'utf8',
    ),
    readFile(
      resolve(
        repositoryRoot,
        'deploy/systemd/planner-user-backup-restore.service',
      ),
      'utf8',
    ),
    readFile(
      resolve(repositoryRoot, 'deploy/systemd/planner-task-reminders.service'),
      'utf8',
    ),
    readFile(
      resolve(repositoryRoot, 'deploy/systemd/planner-backup.service'),
      'utf8',
    ),
    readFile(
      resolve(repositoryRoot, 'deploy/systemd/planner-backup.timer'),
      'utf8',
    ),
    readFile(
      resolve(repositoryRoot, 'deploy/systemd/planner-backup-prune.service'),
      'utf8',
    ),
    readFile(
      resolve(repositoryRoot, 'deploy/systemd/planner-backup-prune.timer'),
      'utf8',
    ),
    readFile(
      resolve(repositoryRoot, 'deploy/systemd/planner-restore-drill.service'),
      'utf8',
    ),
    readFile(
      resolve(repositoryRoot, 'deploy/systemd/planner-restore-drill.timer'),
      'utf8',
    ),
    readFile(resolve(repositoryRoot, 'deploy/caddy/Caddyfile'), 'utf8'),
    readFile(resolve(repositoryRoot, 'scripts/deploy-prod.mjs'), 'utf8'),
    readFile(resolve(repositoryRoot, 'scripts/db-backup.mjs'), 'utf8'),
  ])

  assert.match(apiUnit, /^WorkingDirectory=\/opt\/planner\/current$/m)
  assert.match(apiUnit, /^User=planner-api$/m)
  assert.match(apiUnit, /^EnvironmentFile=\/etc\/planner\/api\.env$/m)
  assert.match(apiUnit, /^ProtectSystem=strict$/m)
  assert.match(apiUnit, /^NoNewPrivileges=true$/m)
  assert.match(apiUnit, /apps\/api\/dist\/server\.js/)
  assert.match(restoreHelperUnit, /^User=planner-restore$/m)
  assert.match(
    restoreHelperUnit,
    /^EnvironmentFile=\/etc\/planner\/restore-helper\.env$/m,
  )
  assert.match(restoreHelperUnit, /^ProtectSystem=strict$/m)
  assert.match(workerUnit, /^WorkingDirectory=\/opt\/planner\/current$/m)
  assert.match(workerUnit, /^User=planner-worker$/m)
  assert.match(workerUnit, /^EnvironmentFile=\/etc\/planner\/reminders\.env$/m)
  assert.match(workerUnit, /apps\/api\/dist\/task-reminders\.js/)
  assert.match(backupUnit, /^WorkingDirectory=\/opt\/planner\/current$/m)
  assert.match(backupUnit, /^User=planner-backup$/m)
  assert.match(backupUnit, /^EnvironmentFile=\/etc\/planner\/backup-job\.env$/m)
  assert.match(backupUnit, /^EnvironmentFile=\/etc\/planner\/release\.env$/m)
  assert.match(
    backupPruneUnit,
    /^EnvironmentFile=\/etc\/planner\/release\.env$/m,
  )
  assert.match(
    restoreDrillUnit,
    /^EnvironmentFile=\/etc\/planner\/release\.env$/m,
  )
  assert.match(backupUnit, /BACKUP_REQUIRE_OFFSITE=1/)
  assert.doesNotMatch(backupUnit, /planner\.env/)
  assert.match(backupTimer, /^Persistent=true$/m)
  assert.match(backupTimer, /^RandomizedDelaySec=30m$/m)
  assert.match(backupPruneUnit, /infrastructure-backup-prune\.mjs/)
  assert.match(backupPruneTimer, /^OnCalendar=Sun /m)
  assert.match(restoreDrillUnit, /infrastructure-restore-drill\.mjs/)
  assert.match(restoreDrillTimer, /^OnCalendar=\*-\*-01 /m)
  assert.match(
    caddyfile,
    /^\s*root \* \/opt\/planner\/current\/apps\/web\/dist$/m,
  )
  assert.match(deploySource, /Dry run: tracked source archive upload skipped/)
  assert.doesNotMatch(deploySource, /\.deploy-dry-run-/)
  assert.doesNotMatch(
    deploySource,
    /`\$\{config\.remoteHost\}:\$\{config\.remoteRoot\}\/`,/,
  )
  assert.match(backupSource, /process\.env\.DB_BACKUP_DIR/)
  assert.match(deploySource, /BACKUP_AUTOMATION_ENABLED/)
  assert.match(deploySource, /planner-backup\.service/)
  assert.match(deploySource, /printf 'PLANNER_APP_COMMIT=%s\\n'/)
  assert.match(
    deploySource,
    /mv -f \/etc\/planner\/release\.env\.next \/etc\/planner\/release\.env/,
  )
})

function assertBashSyntax(script) {
  const result = spawnSync('/bin/bash', ['-n'], {
    encoding: 'utf8',
    input: script,
  })

  assert.equal(result.status, 0, result.stderr)
}

function runDatabaseTransportValidator(script, databaseUrl) {
  return spawnSync(
    '/bin/bash',
    ['-c', `${script}\nvalidate_database_transport "$DATABASE_URL"`],
    {
      encoding: 'utf8',
      env: { ...process.env, DATABASE_URL: databaseUrl },
    },
  )
}

function assertOrder(source, before, after) {
  const beforeIndex = source.indexOf(before)
  const afterIndex = source.indexOf(after, beforeIndex + before.length)

  assert.notEqual(beforeIndex, -1, `Missing marker: ${before}`)
  assert.notEqual(afterIndex, -1, `Missing marker: ${after}`)
  assert.ok(beforeIndex < afterIndex, `${before} must precede ${after}`)
}

function extractBetween(source, startMarker, endMarker) {
  const start = source.indexOf(startMarker)
  const end = source.indexOf(endMarker, start + startMarker.length)

  assert.notEqual(start, -1, `Missing marker: ${startMarker}`)
  assert.notEqual(end, -1, `Missing marker: ${endMarker}`)

  return source.slice(start, end)
}
