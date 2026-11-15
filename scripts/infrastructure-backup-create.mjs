import { mkdir, readFile, rename, rm, stat } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import { runInfrastructureBackupCommand } from './infrastructure-backup-command.mjs'
import {
  assertBackupAssetReferences,
  collectFileInventory,
  copyBackupAssetDirectory,
  createInfrastructureBackupId,
  createInfrastructureBackupManifest,
  createPgToolConnectionString,
  hashFile,
  resolveBackupConnectionString,
  verifyInfrastructureBackupSet,
  writeJsonAtomic,
} from './infrastructure-backup-helpers.mjs'
import { withInfrastructureBackupSnapshot } from './infrastructure-backup-snapshot.mjs'

const environment = process.env
const backupRoot = path.resolve(
  environment.INFRASTRUCTURE_BACKUP_DIR ??
    path.join(environment.DB_BACKUP_DIR ?? 'backups', 'infrastructure'),
)
const statusPath = path.resolve(
  environment.INFRASTRUCTURE_BACKUP_STATUS_PATH ??
    path.join(backupRoot, 'status.json'),
)
const assetSourceDirectory = path.resolve(
  environment.API_ICON_ASSET_DIR ?? 'tmp/icon-assets',
)
const backupId = createInfrastructureBackupId()
const incompleteDirectory = path.join(backupRoot, `.incomplete-${backupId}`)
const finalDirectory = path.join(backupRoot, backupId)
const startedAt = new Date().toISOString()

try {
  await mkdir(backupRoot, { recursive: true })
  await mkdir(incompleteDirectory, { recursive: false })

  const dumpPath = path.join(incompleteDirectory, 'postgres.dump')
  const connectionString = createPgToolConnectionString(
    resolveBackupConnectionString(environment),
  )

  const { assetFiles, assetReferences, assetSourcePresent } =
    await withInfrastructureBackupSnapshot(
      connectionString,
      async ({ snapshotId, assetReferences }) => {
        await runInfrastructureBackupCommand('pg_dump', [
          '--format=custom',
          '--snapshot',
          snapshotId,
          '--enable-row-security',
          '--no-owner',
          '--no-privileges',
          '--file',
          dumpPath,
          connectionString,
        ])

        const assetDirectory = path.join(incompleteDirectory, 'assets')
        let assetSourcePresent = true

        try {
          await stat(assetSourceDirectory)
        } catch (error) {
          if (!isFileNotFoundError(error)) {
            throw error
          }

          assetSourcePresent = false

          if (environment.BACKUP_REQUIRE_ASSETS === '1') {
            throw new Error(
              `Required API_ICON_ASSET_DIR does not exist: ${assetSourceDirectory}`,
            )
          }
        }

        if (assetSourcePresent)
          await copyBackupAssetDirectory(assetSourceDirectory, assetDirectory)
        else await mkdir(assetDirectory)

        const assetFiles = await collectFileInventory(assetDirectory)
        assertBackupAssetReferences(assetReferences, assetFiles)
        return { assetFiles, assetReferences, assetSourcePresent }
      },
    )
  const dumpMetadata = await stat(dumpPath)
  const pgDumpVersion = await runInfrastructureBackupCommand(
    'pg_dump',
    ['--version'],
    { capture: true },
  )
  const packageJson = JSON.parse(
    await readFile(new URL('../package.json', import.meta.url), 'utf8'),
  )
  const appCommit =
    environment.PLANNER_APP_COMMIT ??
    (await readGitCommit().catch(() => 'unknown-commit'))
  const completedAt = new Date().toISOString()
  const manifest = createInfrastructureBackupManifest({
    appCommit,
    appVersion: String(packageJson.version ?? 'unknown'),
    assetFiles,
    assetReferences,
    assetSourceDirectory,
    assetSourcePresent,
    backupId,
    completedAt,
    dumpByteLength: dumpMetadata.size,
    dumpSha256: await hashFile(dumpPath),
    host: os.hostname(),
    pgDumpVersion,
    startedAt,
  })

  await writeJsonAtomic(
    path.join(incompleteDirectory, 'manifest.json'),
    manifest,
  )
  await verifyInfrastructureBackupSet(incompleteDirectory, {
    runCommand: runInfrastructureBackupCommand,
  })
  await rename(incompleteDirectory, finalDirectory)

  const offsiteConfigured = Boolean(environment.RESTIC_REPOSITORY?.trim())

  if (offsiteConfigured) {
    await runInfrastructureBackupCommand('restic', [
      'backup',
      finalDirectory,
      '--group-by',
      'host',
      '--tag',
      'planner',
      '--tag',
      `backup-id:${backupId}`,
      '--tag',
      'kind:infrastructure',
    ])
  } else if (environment.BACKUP_REQUIRE_OFFSITE === '1') {
    throw new Error(
      'RESTIC_REPOSITORY is required when BACKUP_REQUIRE_OFFSITE=1.',
    )
  } else {
    console.warn(
      '[backup] RESTIC_REPOSITORY is not configured; backup remains local only.',
    )
  }

  await writeJsonAtomic(statusPath, {
    backupId,
    completedAt: new Date().toISOString(),
    localDirectory: finalDirectory,
    offsite: offsiteConfigured,
    startedAt,
    status: 'success',
  })
  console.log(`[backup] Infrastructure backup completed: ${finalDirectory}`)
} catch (error) {
  await rm(incompleteDirectory, { force: true, recursive: true })
  await writeJsonAtomic(statusPath, {
    backupId,
    error: error instanceof Error ? error.message : String(error),
    failedAt: new Date().toISOString(),
    startedAt,
    status: 'failed',
  }).catch(() => undefined)
  throw error
}

async function readGitCommit() {
  return runInfrastructureBackupCommand('git', ['rev-parse', 'HEAD'], {
    capture: true,
  })
}

function isFileNotFoundError(error) {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    error.code === 'ENOENT'
  )
}
