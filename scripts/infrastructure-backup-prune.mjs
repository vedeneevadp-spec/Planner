import { mkdir } from 'node:fs/promises'
import path from 'node:path'

import { runInfrastructureBackupCommand } from './infrastructure-backup-command.mjs'
import {
  pruneLocalInfrastructureBackups,
  readPositiveInteger,
} from './infrastructure-backup-helpers.mjs'

const environment = process.env
const backupRoot = path.resolve(
  environment.INFRASTRUCTURE_BACKUP_DIR ??
    path.join(environment.DB_BACKUP_DIR ?? 'backups', 'infrastructure'),
)
const keepDaily = readPositiveInteger(
  environment.RESTIC_KEEP_DAILY,
  'RESTIC_KEEP_DAILY',
  14,
)
const keepWeekly = readPositiveInteger(
  environment.RESTIC_KEEP_WEEKLY,
  'RESTIC_KEEP_WEEKLY',
  8,
)
const keepMonthly = readPositiveInteger(
  environment.RESTIC_KEEP_MONTHLY,
  'RESTIC_KEEP_MONTHLY',
  12,
)
const localKeepDays = readPositiveInteger(
  environment.BACKUP_LOCAL_KEEP_DAYS,
  'BACKUP_LOCAL_KEEP_DAYS',
  14,
)

await mkdir(backupRoot, { recursive: true })

if (environment.RESTIC_REPOSITORY?.trim()) {
  await runInfrastructureBackupCommand('restic', [
    'forget',
    '--tag',
    'planner',
    '--keep-daily',
    String(keepDaily),
    '--keep-weekly',
    String(keepWeekly),
    '--keep-monthly',
    String(keepMonthly),
    '--prune',
  ])
} else if (environment.BACKUP_REQUIRE_OFFSITE === '1') {
  throw new Error(
    'RESTIC_REPOSITORY is required when BACKUP_REQUIRE_OFFSITE=1.',
  )
}

const removed = await pruneLocalInfrastructureBackups(backupRoot, {
  keepDays: localKeepDays,
})

console.log(
  `[backup] Retention completed; removed ${removed.length} local backup set(s).`,
)
