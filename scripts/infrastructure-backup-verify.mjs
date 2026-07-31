import path from 'node:path'

import { runInfrastructureBackupCommand } from './infrastructure-backup-command.mjs'
import { verifyInfrastructureBackupSet } from './infrastructure-backup-helpers.mjs'

const backupSetDirectory = process.argv[2]

if (!backupSetDirectory) {
  throw new Error(
    'Usage: npm run backup:verify -- /absolute/path/to/planner-infra-<timestamp>',
  )
}

const result = await verifyInfrastructureBackupSet(
  path.resolve(backupSetDirectory),
  {
    runCommand: runInfrastructureBackupCommand,
  },
)

console.log(
  `[backup] Verified ${result.manifest.backupId}: ${result.manifest.postgres.dumpByteLength} dump bytes, ${result.manifest.assets.fileCount} asset files.`,
)
