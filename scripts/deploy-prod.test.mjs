import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { spawnSync } from 'node:child_process'
import { dirname, resolve } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

import {
  createProjectSyncFilter,
  createReleaseLayout,
  parseReleaseRetention,
} from './deploy-prod-helpers.mjs'
import { internalAppTables } from './db-security-repair-config.mjs'
import {
  createRemoteDatabaseTransportValidatorScript,
  createRemoteDeployLockScript,
  createRemotePreparationScript,
  createRemoteReleaseScript,
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

test('holds the remote lock around preparation, rsync, and release', async () => {
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
  assert.match(deploySource, /ServerAliveInterval=15/)
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

test('limits rsync to tracked files inside the inactive release', () => {
  const filter = createProjectSyncFilter([
    'apps/api/src/index.ts',
    'docs/file[1].md',
    'docs\\literal?.md',
    'package.json',
  ])

  assert.match(filter, /^P \/\.env$/m)
  assert.match(filter, /^P \/node_modules\/\*\*\*$/m)
  assert.match(filter, /^\+ \/apps\/$/m)
  assert.match(filter, /^\+ \/apps\/api\/src\/index\.ts$/m)
  assert.match(filter, /^\+ \/docs\/file\\\[1\\\]\.md$/m)
  assert.ok(filter.split('\n').includes(String.raw`+ /docs\\literal\?.md`))
  assert.match(filter, /- \/\*\*\*\n$/)
  assert.throws(
    () => createProjectSyncFilter(['../planner.env']),
    /Unexpected tracked file path/,
  )
  assert.throws(
    () => createProjectSyncFilter(['docs/report\n+ /.env']),
    /Unexpected tracked file path/,
  )
})

test('keeps the legacy production root available during first preparation', () => {
  const script = createRemotePreparationScript(layout)

  assertBashSyntax(script)
  assert.match(script, /ln -s "\$remote_root" "\$current_link"/)
  assert.match(script, /Refusing to overwrite the active release/)
  assert.doesNotMatch(script, /rm -rf "\$remote_root"/)
})

test('builds and migrates before the atomic switch, with post-switch rollback', () => {
  const script = createRemoteReleaseScript(layout)

  assertBashSyntax(script)
  assert.match(script, /^set -Eeuo pipefail$/m)
  assertOrder(script, 'npm run toolchain:check', 'npm ci')
  assertOrder(script, 'npm ci', 'npm run build')
  assertOrder(script, 'npm run build', 'npm run db:migrate')
  assertOrder(script, 'npm run db:migrate', 'npm run db:security:repair')
  assertOrder(script, 'npm run db:security:repair', 'npm run db:security:check')
  assertOrder(
    script,
    'npm run db:security:check',
    'atomic_switch "$release_dir"',
  )
  assertOrder(
    script,
    'npm run backup:restore-db:check',
    'atomic_switch "$release_dir"',
  )
  assertOrder(script, 'npm run db:migrate', 'atomic_switch "$release_dir"')
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
  assert.match(script, /npm run backup:restore-db:check/)
  assert.match(
    script,
    /USER_BACKUP_RESTORE_DATABASE_URL must not reuse the runtime DATABASE_URL/,
  )
  assert.match(script, /apply_backup_state/)
  assert.match(script, /planner-backup\.timer/)
  assert.match(script, /planner-restore-drill\.timer/)
  assert.match(script, /atomic_switch "\$previous_release"/)
  assert.match(script, /install_runtime_configs "\$previous_release"/)
  assert.match(script, /rm -f "\$release_dir\/\.deploy-complete"/)
  assert.match(script, /reload_caddy/)
  assert.match(script, /prune_releases/)
})

test('repairs grants for internal offline command ledgers', () => {
  assert.deepEqual(internalAppTables, [
    'cleaning_operations',
    'device_sessions',
    'rate_limit_buckets',
    'schema_migrations',
    'self_care_command_ledger',
    'sync_cursors',
  ])
})

test('runtime services and Caddy resolve the current release symlink', async () => {
  const [
    apiUnit,
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
  assert.match(workerUnit, /^WorkingDirectory=\/opt\/planner\/current$/m)
  assert.match(backupUnit, /^WorkingDirectory=\/opt\/planner\/current$/m)
  assert.match(backupUnit, /^EnvironmentFile=-\/etc\/planner\/backup\.env$/m)
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
  assert.match(backupTimer, /^Persistent=true$/m)
  assert.match(backupTimer, /^RandomizedDelaySec=30m$/m)
  assert.match(backupPruneUnit, /npm run backup:prune/)
  assert.match(backupPruneTimer, /^OnCalendar=Sun /m)
  assert.match(restoreDrillUnit, /npm run backup:restore-drill/)
  assert.match(restoreDrillTimer, /^OnCalendar=\*-\*-01 /m)
  assert.match(
    caddyfile,
    /^\s*root \* \/opt\/planner\/current\/apps\/web\/dist$/m,
  )
  assert.match(deploySource, /\.deploy-dry-run-\$\{layout\.releaseId\}/)
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
