import { createHash, randomUUID } from 'node:crypto'
import { link, mkdir, readFile, unlink, writeFile } from 'node:fs/promises'
import path from 'node:path'

import {
  type UserBackupArchive,
  type UserBackupRestoreResponse,
  userBackupRestoreResponseSchema,
  type UserBackupRestoreTableResult,
  type UserBackupRow,
  type UserBackupTableName,
} from '@planner/contracts/backup'
import { type Kysely, sql, type Transaction } from 'kysely'

import { HttpError } from '../../bootstrap/http-error.js'
import {
  type DatabaseExecutor,
  withWriteTransaction,
} from '../../infrastructure/db/rls.js'
import type { DatabaseSchema } from '../../infrastructure/db/schema.js'
import type { UserBackupRestoreInput } from './backup.model.js'

interface RestoreTablePolicy {
  deferredColumns?: string[]
  hasDeletedAt?: boolean
  name: UserBackupTableName
  primaryKey?: 'id' | 'task_id'
  skip?: boolean
}

interface PreparedAssetResult {
  avatarUrl?: string
  createdPaths: string[]
  restored: number
  reused: number
}

const RESTORE_TABLE_POLICIES: RestoreTablePolicy[] = [
  { hasDeletedAt: true, name: 'projects' },
  { hasDeletedAt: true, name: 'task_templates' },
  {
    deferredColumns: ['root_task_id'],
    hasDeletedAt: true,
    name: 'task_chains',
  },
  {
    deferredColumns: ['chain_id', 'parent_task_id', 'previous_task_id'],
    hasDeletedAt: true,
    name: 'tasks',
  },
  { hasDeletedAt: true, name: 'task_time_blocks' },
  { name: 'task_occurrences' },
  { hasDeletedAt: true, name: 'task_attachments', skip: true },
  { hasDeletedAt: true, name: 'daily_plans' },
  { hasDeletedAt: true, name: 'chaos_inbox_items' },
  { hasDeletedAt: true, name: 'cleaning_zones' },
  { hasDeletedAt: true, name: 'cleaning_tasks' },
  {
    name: 'cleaning_task_states',
    primaryKey: 'task_id',
  },
  { name: 'cleaning_task_history' },
  { hasDeletedAt: true, name: 'habits' },
  { hasDeletedAt: true, name: 'habit_entries' },
  { hasDeletedAt: true, name: 'self_care_items' },
  { name: 'self_care_item_alternatives' },
  { name: 'self_care_schedule_rules' },
  { name: 'self_care_ritual_steps' },
  { name: 'self_care_occurrences' },
  { name: 'self_care_completions' },
  { name: 'self_care_ritual_step_completions' },
  { name: 'self_care_ritual_step_drafts' },
  { name: 'self_care_procedure_details' },
  { name: 'self_care_appointment_details' },
  { name: 'self_care_medical_details' },
  { name: 'self_care_course_details' },
  { name: 'self_care_measurement_details' },
  { name: 'self_care_exercise_details' },
  { name: 'self_care_daily_states' },
  { name: 'self_care_settings' },
  { name: 'self_care_minimum_items' },
]

const USER_SAFE_RESTORE_COLUMNS = [
  'display_name',
  'avatar_url',
  'timezone',
  'locale',
  'default_time_zone',
  'last_seen_time_zone',
  'time_zone_mode',
  'calendar_view_mode',
  'energy_mode',
  'voice_assistant_enabled',
] as const

const WORKSPACE_SAFE_RESTORE_COLUMNS = [
  'name',
  'description',
  'default_time_zone',
  'task_completion_confetti_enabled',
  'wake_word_training_mode_enabled',
] as const

const NON_RESTORED_UPDATE_COLUMNS = new Set([
  'created_at',
  'id',
  'task_id',
  'updated_at',
  'version',
])

const JSON_BACKUP_COLUMNS = new Set(['exercise_sets', 'metadata'])

const ASSET_EXTENSIONS = new Map([
  ['image/gif', 'gif'],
  ['image/jpeg', 'jpg'],
  ['image/png', 'png'],
  ['image/webp', 'webp'],
])

export async function restorePostgresPersonalWorkspace(
  db: Kysely<DatabaseSchema>,
  assetDirectory: string,
  input: UserBackupRestoreInput,
): Promise<UserBackupRestoreResponse> {
  assertPrivilegedRestoreScope(input)
  const createdAssetPaths: string[] = []

  try {
    return await withWriteTransaction(db, null, async (trx) => {
      await lockWorkspaceRestore(trx, input.context.workspaceId)
      const operation = await reserveRestoreOperation(trx, input)

      if (operation.existingResponse) {
        return operation.existingResponse
      }

      const preparedAssets = await prepareProfileAsset(assetDirectory, input)

      createdAssetPaths.push(...preparedAssets.createdPaths)

      const tableResults = createAnchorResults(input)

      await restoreSafeAnchors(
        trx,
        input,
        preparedAssets.avatarUrl,
        tableResults,
      )

      const appliedIdentifiers = new Map<UserBackupTableName, Set<string>>()

      for (const policy of RESTORE_TABLE_POLICIES) {
        const rows = input.archive.tables[policy.name] ?? []

        if (rows.length === 0) {
          continue
        }

        if (policy.skip) {
          tableResults.set(
            policy.name,
            createTableResult(policy.name, { skipped: rows.length }),
          )
          continue
        }

        const result = await restoreTableRows(trx, policy, rows)

        tableResults.set(policy.name, result.summary)
        appliedIdentifiers.set(policy.name, result.appliedIdentifiers)
      }

      await applyDeferredReferences(trx, input.archive, appliedIdentifiers)

      const response = createRestoreResponse(
        input,
        operation.operationId,
        tableResults,
        preparedAssets,
      )

      await completeRestoreOperation(trx, operation.operationId, response)

      return response
    })
  } catch (error) {
    await Promise.all(
      createdAssetPaths.map((filePath) =>
        unlink(filePath).catch((unlinkError) => {
          if (!isFileNotFoundError(unlinkError)) {
            console.warn(
              `[backup] Failed to remove staged restore asset ${filePath}.`,
              unlinkError,
            )
          }
        }),
      ),
    )

    if (isUniqueViolation(error)) {
      throw new HttpError(
        409,
        'backup_restore_conflict',
        'Backup restore conflicts with current workspace data.',
      )
    }

    if (isRestoreDatabaseUnavailable(error)) {
      throw new HttpError(
        503,
        'backup_restore_unavailable',
        'Backup restore database is unavailable.',
      )
    }

    throw error
  }
}

function assertPrivilegedRestoreScope(input: UserBackupRestoreInput): void {
  if (
    input.context.workspaceKind !== 'personal' ||
    input.archive.scope.workspaceKind !== 'personal' ||
    input.archive.scope.userId !== input.context.actorUserId ||
    input.archive.scope.workspaceId !== input.context.workspaceId
  ) {
    throw new HttpError(
      403,
      'backup_restore_scope_mismatch',
      'Privileged backup restore scope validation failed.',
    )
  }

  const userScopeColumns = [
    'assignee_user_id',
    'created_by',
    'invited_by',
    'owner_user_id',
    'updated_by',
    'user_id',
  ]

  for (const [tableName, rows] of Object.entries(input.archive.tables)) {
    for (const row of rows ?? []) {
      if (tableName === 'users' && row.id !== input.context.actorUserId) {
        throw createPrivilegedScopeError()
      }

      if (tableName === 'workspaces' && row.id !== input.context.workspaceId) {
        throw createPrivilegedScopeError()
      }

      if (
        typeof row.workspace_id === 'string' &&
        row.workspace_id !== input.context.workspaceId
      ) {
        throw createPrivilegedScopeError()
      }

      if (
        userScopeColumns.some(
          (column) =>
            typeof row[column] === 'string' &&
            row[column] !== input.context.actorUserId,
        )
      ) {
        throw createPrivilegedScopeError()
      }
    }
  }
}

function createPrivilegedScopeError(): HttpError {
  return new HttpError(
    403,
    'backup_restore_scope_mismatch',
    'Privileged backup restore contains data outside the authenticated scope.',
  )
}

async function lockWorkspaceRestore(
  executor: DatabaseExecutor,
  workspaceId: string,
): Promise<void> {
  await sql`
    select pg_advisory_xact_lock(hashtextextended(${workspaceId}, 7_334_202_607))
  `.execute(executor)
}

async function reserveRestoreOperation(
  trx: Transaction<DatabaseSchema>,
  input: UserBackupRestoreInput,
): Promise<{
  existingResponse?: UserBackupRestoreResponse
  operationId: string
}> {
  const operationId = randomUUID()
  const inserted = await sql<{ id: string }>`
    insert into app.user_backup_restore_operations (
      id,
      workspace_id,
      user_id,
      idempotency_key,
      archive_sha256,
      status,
      response
    )
    values (
      ${operationId},
      ${input.context.workspaceId},
      ${input.context.actorUserId},
      ${input.idempotencyKey},
      ${input.archiveDigest},
      'applying',
      null
    )
    on conflict (workspace_id, user_id, idempotency_key) do nothing
    returning id
  `.execute(trx)

  if (inserted.rows.length > 0) {
    return { operationId }
  }

  const existing = await sql<{
    archive_sha256: string
    id: string
    response: unknown
    status: string
  }>`
    select id, archive_sha256, status, response
    from app.user_backup_restore_operations
    where workspace_id = ${input.context.workspaceId}
      and user_id = ${input.context.actorUserId}
      and idempotency_key = ${input.idempotencyKey}
    limit 1
  `.execute(trx)
  const row = existing.rows[0]

  if (!row) {
    throw new Error('Backup restore idempotency record disappeared.')
  }

  if (row.archive_sha256 !== input.archiveDigest) {
    throw new HttpError(
      409,
      'backup_restore_idempotency_mismatch',
      'Idempotency-Key was already used for a different backup archive.',
    )
  }

  if (row.status !== 'completed' || !row.response) {
    throw new HttpError(
      409,
      'backup_restore_in_progress',
      'Backup restore is already in progress.',
    )
  }

  return {
    existingResponse: userBackupRestoreResponseSchema.parse(row.response),
    operationId: row.id,
  }
}

async function completeRestoreOperation(
  trx: Transaction<DatabaseSchema>,
  operationId: string,
  response: UserBackupRestoreResponse,
): Promise<void> {
  await sql`
    update app.user_backup_restore_operations
    set
      status = 'completed',
      response = ${JSON.stringify(response)}::jsonb,
      completed_at = now()
    where id = ${operationId}
  `.execute(trx)
}

function createAnchorResults(
  input: UserBackupRestoreInput,
): Map<UserBackupTableName, UserBackupRestoreTableResult> {
  const results = new Map<UserBackupTableName, UserBackupRestoreTableResult>()
  const userCount = input.archive.tables.users?.length ?? 0
  const workspaceCount = input.archive.tables.workspaces?.length ?? 0
  const membershipCount = input.archive.tables.workspace_members?.length ?? 0

  if (userCount > 0) {
    results.set(
      'users',
      createTableResult('users', {
        kept: input.restoreProfile ? 0 : userCount,
        updated: input.restoreProfile ? userCount : 0,
      }),
    )
  }

  if (workspaceCount > 0) {
    results.set(
      'workspaces',
      createTableResult('workspaces', {
        kept: input.restoreWorkspaceSettings ? 0 : workspaceCount,
        updated: input.restoreWorkspaceSettings ? workspaceCount : 0,
      }),
    )
  }

  if (membershipCount > 0) {
    results.set(
      'workspace_members',
      createTableResult('workspace_members', {
        kept: membershipCount,
      }),
    )
  }

  return results
}

async function restoreSafeAnchors(
  trx: Transaction<DatabaseSchema>,
  input: UserBackupRestoreInput,
  avatarUrl: string | undefined,
  results: Map<UserBackupTableName, UserBackupRestoreTableResult>,
): Promise<void> {
  if (input.restoreProfile) {
    const userRow = input.archive.tables.users?.find(
      (row) => row.id === input.context.actorUserId,
    )

    if (userRow) {
      await updateSafeAnchor(
        trx,
        'app.users',
        'id',
        input.context.actorUserId,
        {
          ...pickColumns(userRow, USER_SAFE_RESTORE_COLUMNS),
          ...(avatarUrl ? { avatar_url: avatarUrl } : {}),
        },
      )
    } else {
      results.delete('users')
    }
  }

  if (input.restoreWorkspaceSettings) {
    const workspaceRow = input.archive.tables.workspaces?.find(
      (row) => row.id === input.context.workspaceId,
    )

    if (workspaceRow) {
      await updateSafeAnchor(
        trx,
        'app.workspaces',
        'id',
        input.context.workspaceId,
        pickColumns(workspaceRow, WORKSPACE_SAFE_RESTORE_COLUMNS),
      )
    } else {
      results.delete('workspaces')
    }
  }
}

async function updateSafeAnchor(
  executor: DatabaseExecutor,
  tableName: 'app.users' | 'app.workspaces',
  primaryKey: string,
  identifier: string,
  values: UserBackupRow,
): Promise<void> {
  const entries = Object.entries(values).filter(
    ([, value]) => value !== undefined,
  )

  if (entries.length === 0) {
    return
  }

  await sql`
    update ${sql.table(tableName)}
    set ${sql.join(
      entries.map(
        ([column, value]) => sql`${sql.ref(column)} = ${toSqlValue(value)}`,
      ),
    )}
    where ${sql.ref(primaryKey)} = ${identifier}
  `.execute(executor)
}

async function restoreTableRows(
  trx: Transaction<DatabaseSchema>,
  policy: RestoreTablePolicy,
  rows: UserBackupRow[],
): Promise<{
  appliedIdentifiers: Set<string>
  summary: UserBackupRestoreTableResult
}> {
  const primaryKey = policy.primaryKey ?? 'id'
  const identifiers = rows.map((row) => readRequiredIdentifier(row, primaryKey))
  const existingRows = await loadExistingRows(
    trx,
    policy,
    primaryKey,
    identifiers,
  )
  const existingById = new Map(existingRows.map((row) => [row.identifier, row]))
  const insertedRows: UserBackupRow[] = []
  const resurrectedRows: UserBackupRow[] = []
  const appliedIdentifiers = new Set<string>()
  let kept = 0

  for (const row of rows) {
    const identifier = readRequiredIdentifier(row, primaryKey)
    const existing = existingById.get(identifier)

    if (!existing) {
      insertedRows.push(stripDeferredColumns(row, policy))
      appliedIdentifiers.add(identifier)
      continue
    }

    if (policy.hasDeletedAt && existing.deletedAt !== null) {
      resurrectedRows.push(row)
      appliedIdentifiers.add(identifier)
      continue
    }

    kept += 1
  }

  await insertRows(trx, policy.name, primaryKey, insertedRows)

  for (const row of resurrectedRows) {
    await resurrectRow(trx, policy, primaryKey, row)
  }

  return {
    appliedIdentifiers,
    summary: createTableResult(policy.name, {
      inserted: insertedRows.length,
      kept,
      resurrected: resurrectedRows.length,
    }),
  }
}

async function loadExistingRows(
  executor: DatabaseExecutor,
  policy: RestoreTablePolicy,
  primaryKey: string,
  identifiers: string[],
): Promise<Array<{ deletedAt: unknown; identifier: string }>> {
  if (identifiers.length === 0) {
    return []
  }

  const result = await sql<{ deleted_at: unknown; identifier: string }>`
    select
      ${sql.ref(primaryKey)} as identifier,
      ${policy.hasDeletedAt ? sql.ref('deleted_at') : sql`null`} as deleted_at
    from ${sql.table(`app.${policy.name}`)}
    where ${sql.ref(primaryKey)} in (${sql.join(identifiers)})
  `.execute(executor)

  return result.rows.map((row) => ({
    deletedAt: row.deleted_at,
    identifier: row.identifier,
  }))
}

async function insertRows(
  executor: DatabaseExecutor,
  tableName: UserBackupTableName,
  primaryKey: string,
  rows: UserBackupRow[],
): Promise<void> {
  const groups = groupRowsByColumns(rows)

  for (const group of groups) {
    for (let offset = 0; offset < group.rows.length; offset += 100) {
      const batch = group.rows.slice(offset, offset + 100)
      const result = await sql<{ identifier: string }>`
        insert into ${sql.table(`app.${tableName}`)}
          (${sql.join(group.columns.map((column) => sql.ref(column)))})
        values ${sql.join(
          batch.map(
            (row) =>
              sql`(${sql.join(
                group.columns.map((column) => toSqlValue(row[column], column)),
              )})`,
          ),
        )}
        returning ${sql.ref(primaryKey)} as identifier
      `.execute(executor)

      if (result.rows.length !== batch.length) {
        throw new Error(
          `Backup restore inserted an unexpected number of ${tableName} rows.`,
        )
      }
    }
  }
}

async function resurrectRow(
  executor: DatabaseExecutor,
  policy: RestoreTablePolicy,
  primaryKey: string,
  row: UserBackupRow,
): Promise<void> {
  const identifier = readRequiredIdentifier(row, primaryKey)
  const entries = Object.entries(stripDeferredColumns(row, policy)).filter(
    ([column, value]) =>
      !NON_RESTORED_UPDATE_COLUMNS.has(column) && value !== undefined,
  )
  const result = await sql<{ identifier: string }>`
    update ${sql.table(`app.${policy.name}`)}
    set ${sql.join(
      entries.map(
        ([column, value]) =>
          sql`${sql.ref(column)} = ${toSqlValue(value, column)}`,
      ),
    )}
    where ${sql.ref(primaryKey)} = ${identifier}
      and deleted_at is not null
    returning ${sql.ref(primaryKey)} as identifier
  `.execute(executor)

  if (result.rows.length !== 1) {
    throw new HttpError(
      409,
      'backup_restore_stale_state',
      `Backup restore state changed for ${policy.name}.`,
    )
  }
}

async function applyDeferredReferences(
  executor: DatabaseExecutor,
  archive: UserBackupArchive,
  appliedIdentifiers: Map<UserBackupTableName, Set<string>>,
): Promise<void> {
  for (const policy of RESTORE_TABLE_POLICIES) {
    if (!policy.deferredColumns?.length) {
      continue
    }

    const primaryKey = policy.primaryKey ?? 'id'
    const applied = appliedIdentifiers.get(policy.name) ?? new Set()

    for (const row of archive.tables[policy.name] ?? []) {
      const identifier = readRequiredIdentifier(row, primaryKey)

      if (!applied.has(identifier)) {
        continue
      }

      const entries = policy.deferredColumns
        .filter((column) => row[column] !== undefined)
        .map((column) => [column, row[column]] as const)

      if (entries.length === 0) {
        continue
      }

      await sql`
        update ${sql.table(`app.${policy.name}`)}
        set ${sql.join(
          entries.map(
            ([column, value]) => sql`${sql.ref(column)} = ${toSqlValue(value)}`,
          ),
        )}
        where ${sql.ref(primaryKey)} = ${identifier}
      `.execute(executor)
    }
  }
}

async function prepareProfileAsset(
  assetRootDirectory: string,
  input: UserBackupRestoreInput,
): Promise<PreparedAssetResult> {
  const result: PreparedAssetResult = {
    createdPaths: [],
    restored: 0,
    reused: 0,
  }

  if (!input.restoreProfile) {
    return result
  }

  const userRow = input.archive.tables.users?.find(
    (row) => row.id === input.context.actorUserId,
  )
  const avatarUrl =
    typeof userRow?.avatar_url === 'string' ? userRow.avatar_url : null

  if (!avatarUrl?.startsWith('/api/v1/profile-assets/')) {
    return result
  }

  const asset = input.archive.assets.find(
    (candidate) =>
      candidate.kind === 'profile_avatar' && candidate.path === avatarUrl,
  )

  if (!asset) {
    throw new Error('Validated backup archive is missing its profile asset.')
  }

  const extension = ASSET_EXTENSIONS.get(asset.contentType)

  if (!extension) {
    throw new Error(`Unsupported profile asset type: ${asset.contentType}`)
  }

  const buffer = Buffer.from(asset.base64, 'base64')
  const digest = createHash('sha256').update(buffer).digest('hex')
  const profilesDirectory = path.join(
    path.resolve(assetRootDirectory),
    'profiles',
  )
  const fileName = `${input.context.actorUserId}-${digest.slice(0, 32)}.${extension}`
  const filePath = path.join(profilesDirectory, fileName)

  await mkdir(profilesDirectory, { recursive: true })

  const wasCreated = await writeContentAddressedFile(filePath, buffer, digest)

  if (wasCreated) {
    result.createdPaths.push(filePath)
    result.restored = 1
  } else {
    result.reused = 1
  }

  result.avatarUrl = `/api/v1/profile-assets/${fileName}`

  return result
}

async function writeContentAddressedFile(
  filePath: string,
  buffer: Buffer,
  expectedDigest: string,
): Promise<boolean> {
  const temporaryPath = `${filePath}.restore-${process.pid}-${randomUUID()}`

  await writeFile(temporaryPath, buffer, {
    flag: 'wx',
    mode: 0o600,
  })

  try {
    try {
      await link(temporaryPath, filePath)
      return true
    } catch (error) {
      if (!isFileExistsError(error)) {
        throw error
      }

      const existingDigest = createHash('sha256')
        .update(await readFile(filePath))
        .digest('hex')

      if (existingDigest !== expectedDigest) {
        throw new Error(
          `Existing restored asset has unexpected content: ${filePath}`,
        )
      }

      return false
    }
  } finally {
    await unlink(temporaryPath).catch(() => undefined)
  }
}

function createRestoreResponse(
  input: UserBackupRestoreInput,
  operationId: string,
  tableResults: Map<UserBackupTableName, UserBackupRestoreTableResult>,
  assets: PreparedAssetResult,
): UserBackupRestoreResponse {
  const tables = [...tableResults.values()].sort((left, right) =>
    left.name.localeCompare(right.name),
  )
  const totals = tables.reduce(
    (result, table) => ({
      inserted: result.inserted + table.inserted,
      kept: result.kept + table.kept,
      resurrected: result.resurrected + table.resurrected,
      skipped: result.skipped + table.skipped,
      updated: result.updated + table.updated,
    }),
    {
      inserted: 0,
      kept: 0,
      resurrected: 0,
      skipped: 0,
      updated: 0,
    },
  )

  return userBackupRestoreResponseSchema.parse({
    archiveDigest: input.archiveDigest,
    assets: {
      restored: assets.restored,
      reused: assets.reused,
    },
    operationId,
    status: 'completed',
    tables,
    totals,
  })
}

function createTableResult(
  name: UserBackupTableName,
  overrides: Partial<Omit<UserBackupRestoreTableResult, 'name'>> = {},
): UserBackupRestoreTableResult {
  return {
    inserted: overrides.inserted ?? 0,
    kept: overrides.kept ?? 0,
    name,
    resurrected: overrides.resurrected ?? 0,
    skipped: overrides.skipped ?? 0,
    updated: overrides.updated ?? 0,
  }
}

function groupRowsByColumns(
  rows: UserBackupRow[],
): Array<{ columns: string[]; rows: UserBackupRow[] }> {
  const groups = new Map<string, { columns: string[]; rows: UserBackupRow[] }>()

  for (const row of rows) {
    const columns = Object.keys(row)
      .filter((column) => row[column] !== undefined)
      .sort()
    const signature = columns.join('\u0000')
    const group = groups.get(signature)

    if (group) {
      group.rows.push(row)
    } else {
      groups.set(signature, { columns, rows: [row] })
    }
  }

  return [...groups.values()]
}

function stripDeferredColumns(
  row: UserBackupRow,
  policy: RestoreTablePolicy,
): UserBackupRow {
  if (!policy.deferredColumns?.length) {
    return row
  }

  const result = { ...row }

  for (const column of policy.deferredColumns) {
    delete result[column]
  }

  return result
}

function pickColumns(
  row: UserBackupRow,
  columns: readonly string[],
): UserBackupRow {
  return Object.fromEntries(
    columns
      .filter((column) => row[column] !== undefined)
      .map((column) => [column, row[column]]),
  )
}

function readRequiredIdentifier(row: UserBackupRow, column: string): string {
  const value = row[column]

  if (typeof value !== 'string') {
    throw new Error(`Backup row is missing identifier column ${column}.`)
  }

  return value
}

function toSqlValue(value: unknown, column?: string) {
  const normalizedValue =
    column && JSON_BACKUP_COLUMNS.has(column) && typeof value === 'object'
      ? JSON.stringify(value)
      : value

  return sql`${normalizedValue}`
}

function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    error.code === '23505'
  )
}

function isRestoreDatabaseUnavailable(error: unknown): boolean {
  if (typeof error !== 'object' || error === null || !('code' in error)) {
    return false
  }

  return new Set([
    '28P01',
    '3D000',
    '42501',
    '53300',
    '57P01',
    '57P02',
    '57P03',
    'EAI_AGAIN',
    'ECONNREFUSED',
    'ENOTFOUND',
    'ETIMEDOUT',
  ]).has(String(error.code))
}

function isFileExistsError(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    error.code === 'EEXIST'
  )
}

function isFileNotFoundError(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    error.code === 'ENOENT'
  )
}
