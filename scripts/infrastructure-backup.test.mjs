import assert from 'node:assert/strict'
import { symlink } from 'node:fs'
import {
  access,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  utimes,
  writeFile,
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'

import {
  collectFileInventory,
  createDatabaseUrl,
  createDrillDatabaseName,
  createInfrastructureBackupId,
  createInfrastructureBackupManifest,
  createPgToolConnectionString,
  findLatestInfrastructureBackupSet,
  hashFile,
  parseInfrastructureBackupManifest,
  pruneDeployDatabaseBackups,
  pruneLocalInfrastructureBackups,
  readPositiveInteger,
  redactConnectionString,
  verifyInfrastructureBackupSet,
  writeJsonAtomic,
} from './infrastructure-backup-helpers.mjs'
import {
  buildBackupAlertEmail,
  buildBackupAlertRequest,
} from './infrastructure-backup-alert.mjs'

test('builds webhook, Telegram, and email backup failure alerts', () => {
  const common = {
    failedUnit: 'planner-backup.service',
    hostname: 'planner.test',
    occurredAt: '2026-07-31T10:00:00.000Z',
  }
  const webhook = buildBackupAlertRequest({
    ...common,
    env: {
      BACKUP_ALERT_WEBHOOK_URL: 'https://alerts.example.test/planner',
    },
  })
  const telegram = buildBackupAlertRequest({
    ...common,
    env: {
      BACKUP_ALERT_TELEGRAM_BOT_TOKEN: 'secret-token',
      BACKUP_ALERT_TELEGRAM_CHAT_ID: '-100123',
    },
  })

  assert.equal(webhook.targetUrl, 'https://alerts.example.test/planner')
  assert.equal(webhook.payload.event, 'planner_backup_automation_failed')
  assert.equal(
    telegram.targetUrl,
    'https://api.telegram.org/botsecret-token/sendMessage',
  )
  assert.equal(telegram.payload.chat_id, '-100123')
  const email = buildBackupAlertEmail({
    ...common,
    env: {
      AUTH_EMAIL_FROM: 'Chaotika <support@example.test>',
      AUTH_SMTP_HOST: 'smtp.example.test',
      AUTH_SMTP_PASSWORD: 'smtp-secret',
      AUTH_SMTP_PORT: '465',
      AUTH_SMTP_SECURE: 'true',
      AUTH_SMTP_USER: 'support@example.test',
      BACKUP_ALERT_EMAIL_TO: 'operations@example.test',
    },
  })

  assert.equal(email.message.to, 'operations@example.test')
  assert.equal(email.transport.host, 'smtp.example.test')
  assert.equal(email.transport.port, 465)
  assert.equal(email.transport.secure, true)
  assert.throws(
    () =>
      buildBackupAlertRequest({
        ...common,
        env: {
          BACKUP_ALERT_TELEGRAM_BOT_TOKEN: 'secret-token',
        },
      }),
    /Telegram backup alert credentials/,
  )
  assert.throws(
    () =>
      buildBackupAlertEmail({
        ...common,
        env: {
          BACKUP_ALERT_EMAIL_TO: 'operations@example.test',
        },
      }),
    /complete AUTH_SMTP/,
  )
})

test('restore drill validates only active icon asset references', async () => {
  const source = await readFile(
    new URL('./infrastructure-restore-drill.mjs', import.meta.url),
    'utf8',
  )

  assert.match(
    source,
    /from app\.emoji_assets\s+where deleted_at is null\s+and value like/,
  )
})

test('creates stable infrastructure backup identifiers and drill database names', () => {
  const date = new Date('2026-07-29T01:02:03.456Z')

  assert.equal(
    createInfrastructureBackupId(date),
    'planner-infra-2026-07-29T01-02-03-456Z',
  )
  assert.equal(
    createDrillDatabaseName(date, 'ABC-def-123'),
    'planner_restore_drill_20260729010203_abcdef123',
  )
  assert.equal(
    createDatabaseUrl(
      'postgres://user:secret@db.example.test:5432/postgres?sslmode=require',
      'planner_restore_drill_20260729010203_abcdef123',
    ),
    'postgres://user:secret@db.example.test:5432/planner_restore_drill_20260729010203_abcdef123?sslmode=require',
  )
  assert.throws(
    () =>
      createDatabaseUrl(
        'postgres://user:secret@db.example.test/postgres',
        'production',
      ),
    /Unsafe restore drill database name/,
  )
})

test('sanitizes pg tool connection strings and redacts credentials', () => {
  assert.equal(
    createPgToolConnectionString(
      'postgres://user:secret@db.example.test/planner?sslmode=require&uselibpqcompat=true',
    ),
    'postgres://user:secret@db.example.test/planner?sslmode=require',
  )
  assert.equal(
    redactConnectionString(
      'postgres://user:secret@db.example.test/planner?sslmode=require',
    ),
    'postgres://user:***@db.example.test/planner?sslmode=require',
  )
})

test('collects a deterministic asset inventory and rejects symbolic links', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'planner-backup-assets-'))

  try {
    await mkdir(path.join(root, 'profiles'))
    await writeFile(path.join(root, 'icon.png'), 'icon')
    await writeFile(path.join(root, 'profiles', 'avatar.webp'), 'avatar')

    const inventory = await collectFileInventory(root)

    assert.deepEqual(
      inventory.map((file) => [file.path, file.byteLength]),
      [
        ['icon.png', 4],
        ['profiles/avatar.webp', 6],
      ],
    )
    assert.match(inventory[0]?.sha256 ?? '', /^[a-f0-9]{64}$/)

    await new Promise((resolve, reject) => {
      symlink(
        path.join(root, 'icon.png'),
        path.join(root, 'linked.png'),
        (error) => (error ? reject(error) : resolve()),
      )
    })

    await assert.rejects(
      () => collectFileInventory(root),
      /cannot contain symbolic links/,
    )
  } finally {
    await rm(root, { force: true, recursive: true })
  }
})

test('verifies checksums and manifest contents for a complete backup set', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'planner-backup-set-'))
  const backupId = 'planner-infra-2026-07-29T01-02-03-456Z'
  const backupSetDirectory = path.join(root, backupId)

  try {
    await mkdir(path.join(backupSetDirectory, 'assets', 'profiles'), {
      recursive: true,
    })
    const dumpPath = path.join(backupSetDirectory, 'postgres.dump')
    const avatarPath = path.join(
      backupSetDirectory,
      'assets',
      'profiles',
      'avatar.webp',
    )

    await writeFile(dumpPath, 'custom postgres dump')
    await writeFile(avatarPath, 'avatar')

    const assetFiles = await collectFileInventory(
      path.join(backupSetDirectory, 'assets'),
    )
    const manifest = createInfrastructureBackupManifest({
      appCommit: 'a'.repeat(40),
      appVersion: '1.0.0',
      assetFiles,
      assetSourceDirectory: '/var/lib/planner/icon-assets',
      assetSourcePresent: true,
      backupId,
      completedAt: '2026-07-29T01:03:00.000Z',
      dumpByteLength: 20,
      dumpSha256: await hashFile(dumpPath),
      host: 'planner.test',
      pgDumpVersion: 'pg_dump (PostgreSQL) 18.0',
      startedAt: '2026-07-29T01:02:03.456Z',
    })

    await writeJsonAtomic(
      path.join(backupSetDirectory, 'manifest.json'),
      manifest,
    )

    const verified = await verifyInfrastructureBackupSet(backupSetDirectory, {
      verifyPgRestore: false,
    })

    assert.equal(verified.manifest.backupId, backupId)
    assert.equal(verified.manifest.assets.fileCount, 1)

    await writeFile(avatarPath, 'changed')

    await assert.rejects(
      () =>
        verifyInfrastructureBackupSet(backupSetDirectory, {
          verifyPgRestore: false,
        }),
      /Asset snapshot does not match/,
    )
  } finally {
    await rm(root, { force: true, recursive: true })
  }
})

test('rejects malformed manifest paths, totals, and checksums', () => {
  const validManifest = createInfrastructureBackupManifest({
    appCommit: 'a'.repeat(40),
    appVersion: '1.0.0',
    assetFiles: [
      {
        byteLength: 1,
        path: 'profiles/avatar.webp',
        sha256: 'b'.repeat(64),
      },
    ],
    assetSourceDirectory: '/var/lib/planner/icon-assets',
    assetSourcePresent: true,
    backupId: 'planner-infra-2026-07-29T01-02-03-456Z',
    completedAt: '2026-07-29T01:03:00.000Z',
    dumpByteLength: 20,
    dumpSha256: 'c'.repeat(64),
    host: 'planner.test',
    pgDumpVersion: 'pg_dump (PostgreSQL) 18.0',
    startedAt: '2026-07-29T01:02:03.456Z',
  })

  assert.throws(
    () =>
      parseInfrastructureBackupManifest({
        ...validManifest,
        assets: {
          ...validManifest.assets,
          files: [
            {
              ...validManifest.assets.files[0],
              path: '../secret',
            },
          ],
        },
      }),
    /safe relative path/,
  )
  assert.throws(
    () =>
      parseInfrastructureBackupManifest({
        ...validManifest,
        postgres: {
          ...validManifest.postgres,
          dumpSha256: 'invalid',
        },
      }),
    /SHA-256/,
  )
  assert.throws(
    () =>
      parseInfrastructureBackupManifest({
        ...validManifest,
        assets: {
          ...validManifest.assets,
          totalBytes: 99,
        },
      }),
    /totals do not match/,
  )
})

test('finds the latest backup and prunes only expired safe backup directories', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'planner-backup-prune-'))
  const oldId = 'planner-infra-2026-06-01T01-02-03-456Z'
  const currentId = 'planner-infra-2026-07-28T01-02-03-456Z'
  const unrelatedDirectory = path.join(root, 'do-not-delete')
  const incompleteDirectory = path.join(
    root,
    '.incomplete-planner-infra-2026-06-01T01-02-03-456Z',
  )

  try {
    await createMinimalBackupSet(root, oldId, '2026-06-01T01:03:00.000Z')
    await createMinimalBackupSet(root, currentId, '2026-07-28T01:03:00.000Z')
    await mkdir(unrelatedDirectory)
    await mkdir(incompleteDirectory)
    await utimes(
      incompleteDirectory,
      new Date('2026-06-01T01:03:00.000Z'),
      new Date('2026-06-01T01:03:00.000Z'),
    )

    const latest = await findLatestInfrastructureBackupSet(root)

    assert.equal(latest.manifest.backupId, currentId)

    const removed = await pruneLocalInfrastructureBackups(root, {
      keepDays: 14,
      now: new Date('2026-07-29T00:00:00.000Z'),
    })

    assert.deepEqual(removed, [
      '.incomplete-planner-infra-2026-06-01T01-02-03-456Z',
      oldId,
    ])
    assert.equal(
      await readFile(path.join(root, currentId, 'postgres.dump'), 'utf8'),
      'dump',
    )
    await access(unrelatedDirectory)
  } finally {
    await rm(root, { force: true, recursive: true })
  }
})

test('prunes only old deploy-time database backups and their sidecars', async () => {
  const root = await mkdtemp(
    path.join(tmpdir(), 'planner-deploy-backup-prune-'),
  )
  const backupFiles = [
    'planner-2026-07-27T01-02-03-456Z.dump',
    'planner-2026-07-28T01-02-03-456Z.dump',
    'planner-2026-07-29T01-02-03-456Z.dump',
  ]

  try {
    for (const fileName of backupFiles) {
      await writeFile(path.join(root, fileName), 'dump')
      await writeFile(path.join(root, `${fileName}.manifest.json`), '{}')
      await writeFile(path.join(root, `${fileName}.sha256`), 'digest')
    }

    await writeFile(path.join(root, 'unrelated.dump'), 'keep')

    const removed = await pruneDeployDatabaseBackups(root, 2)

    assert.deepEqual(removed, [backupFiles[0]])
    await assert.rejects(
      () => access(path.join(root, backupFiles[0])),
      /ENOENT/,
    )
    await access(path.join(root, backupFiles[1]))
    await access(path.join(root, backupFiles[2]))
    await access(path.join(root, 'unrelated.dump'))
  } finally {
    await rm(root, { force: true, recursive: true })
  }
})

test('parses positive retention values', () => {
  assert.equal(readPositiveInteger(undefined, 'KEEP', 14), 14)
  assert.equal(readPositiveInteger('30', 'KEEP', 14), 30)
  assert.throws(() => readPositiveInteger('0', 'KEEP', 14), /positive integer/)
  assert.throws(
    () => readPositiveInteger('1.5', 'KEEP', 14),
    /positive integer/,
  )
})

async function createMinimalBackupSet(root, backupId, completedAt) {
  const backupSetDirectory = path.join(root, backupId)

  await mkdir(path.join(backupSetDirectory, 'assets'), { recursive: true })
  const dumpPath = path.join(backupSetDirectory, 'postgres.dump')

  await writeFile(dumpPath, 'dump')
  await writeJsonAtomic(
    path.join(backupSetDirectory, 'manifest.json'),
    createInfrastructureBackupManifest({
      appCommit: 'a'.repeat(40),
      appVersion: '1.0.0',
      assetFiles: [],
      assetSourceDirectory: '/var/lib/planner/icon-assets',
      assetSourcePresent: true,
      backupId,
      completedAt,
      dumpByteLength: 4,
      dumpSha256: await hashFile(dumpPath),
      host: 'planner.test',
      pgDumpVersion: 'pg_dump (PostgreSQL) 18.0',
      startedAt: completedAt,
    }),
  )
}
