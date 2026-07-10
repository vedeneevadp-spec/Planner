import {
  type UserBackupArchive,
  type UserBackupPreviewResponse,
  type UserBackupRow,
  type UserBackupTableName,
  userBackupTableNameSchema,
} from '@planner/contracts'

import { HttpError } from '../../bootstrap/http-error.js'
import type {
  UserBackupContext,
  UserBackupExportResult,
  UserBackupPreviewResult,
} from './backup.model.js'
import type { UserBackupRepository } from './backup.repository.js'

export class UserBackupService {
  constructor(
    private readonly repository: UserBackupRepository,
    private readonly appVersion: string,
  ) {}

  exportBackup(context: UserBackupContext): Promise<UserBackupExportResult> {
    assertAuthenticatedPersonalWorkspace(context)

    return this.repository.exportPersonalWorkspace({
      appVersion: this.appVersion,
      context,
    })
  }

  previewImport(
    context: UserBackupContext,
    archive: UserBackupArchive,
  ): UserBackupPreviewResult {
    assertAuthenticatedPersonalWorkspace(context)

    const warnings = getPreviewWarnings(context, archive)
    const tables = userBackupTableNameSchema.options
      .map((name): { count: number; name: UserBackupTableName } => ({
        count: archive.tables[name]?.length ?? 0,
        name,
      }))
      .filter((table) => table.count > 0)
    const totalBytes = archive.assets.reduce(
      (total, asset) => total + asset.byteLength,
      0,
    )
    const response: UserBackupPreviewResponse = {
      archive: {
        exportedAt: archive.exportedAt,
        format: archive.format,
        sourceAppVersion: archive.source.appVersion,
        version: archive.version,
        workspaceId: archive.scope.workspaceId,
        workspaceKind: archive.scope.workspaceKind,
        workspaceName: archive.scope.workspaceName,
      },
      assets: {
        count: archive.assets.length,
        totalBytes,
      },
      canRestore: warnings.length === 0,
      tables,
      warnings,
    }

    return response
  }
}

function assertAuthenticatedPersonalWorkspace(
  context: UserBackupContext,
): asserts context is UserBackupContext & {
  actorUserId: string
  workspaceKind: 'personal'
} {
  if (!context.auth || !context.actorUserId) {
    throw new HttpError(
      401,
      'authentication_required',
      'A valid bearer token is required for user backups.',
    )
  }

  if (context.workspaceKind !== 'personal') {
    throw new HttpError(
      403,
      'backup_personal_workspace_required',
      'User backups are currently supported only for personal workspaces.',
    )
  }
}

function getPreviewWarnings(
  context: UserBackupContext & {
    actorUserId: string
    workspaceKind: 'personal'
  },
  archive: UserBackupArchive,
): string[] {
  const warnings: string[] = []

  if (archive.scope.userId !== context.actorUserId) {
    warnings.push('Archive belongs to a different user.')
  }

  if (archive.scope.workspaceId !== context.workspaceId) {
    warnings.push('Archive belongs to a different workspace.')
  }

  if (archive.scope.workspaceKind !== 'personal') {
    warnings.push('Only personal workspace archives can be restored.')
  }

  warnings.push(...getDuplicateIdentifierWarnings(archive))
  warnings.push(...getScopeAnchorWarnings(archive))
  warnings.push(...getScopeWarnings(archive))
  warnings.push(...getReferenceWarnings(archive))
  warnings.push(...getArrayReferenceWarnings(archive))
  warnings.push(...getAssetWarnings(archive))

  return warnings
}

interface ReferenceRule {
  sourceColumn: string
  sourceTable: UserBackupTableName
  targetColumn?: string
  targetTable: UserBackupTableName
}

const REFERENCE_RULES: ReferenceRule[] = [
  {
    sourceColumn: 'owner_user_id',
    sourceTable: 'workspaces',
    targetTable: 'users',
  },
  {
    sourceColumn: 'user_id',
    sourceTable: 'workspace_members',
    targetTable: 'users',
  },
  {
    sourceColumn: 'project_id',
    sourceTable: 'tasks',
    targetTable: 'projects',
  },
  {
    sourceColumn: 'chain_id',
    sourceTable: 'tasks',
    targetTable: 'task_chains',
  },
  {
    sourceColumn: 'parent_task_id',
    sourceTable: 'tasks',
    targetTable: 'tasks',
  },
  {
    sourceColumn: 'previous_task_id',
    sourceTable: 'tasks',
    targetTable: 'tasks',
  },
  {
    sourceColumn: 'root_task_id',
    sourceTable: 'task_chains',
    targetTable: 'tasks',
  },
  {
    sourceColumn: 'task_id',
    sourceTable: 'task_time_blocks',
    targetTable: 'tasks',
  },
  {
    sourceColumn: 'task_id',
    sourceTable: 'task_occurrences',
    targetTable: 'tasks',
  },
  {
    sourceColumn: 'task_id',
    sourceTable: 'task_attachments',
    targetTable: 'tasks',
  },
  {
    sourceColumn: 'project_id',
    sourceTable: 'task_templates',
    targetTable: 'projects',
  },
  {
    sourceColumn: 'converted_task_id',
    sourceTable: 'chaos_inbox_items',
    targetTable: 'tasks',
  },
  {
    sourceColumn: 'zone_id',
    sourceTable: 'cleaning_tasks',
    targetTable: 'cleaning_zones',
  },
  {
    sourceColumn: 'task_id',
    sourceTable: 'cleaning_task_states',
    targetTable: 'cleaning_tasks',
  },
  {
    sourceColumn: 'task_id',
    sourceTable: 'cleaning_task_history',
    targetTable: 'cleaning_tasks',
  },
  {
    sourceColumn: 'zone_id',
    sourceTable: 'cleaning_task_history',
    targetTable: 'cleaning_zones',
  },
  {
    sourceColumn: 'sphere_id',
    sourceTable: 'habits',
    targetTable: 'projects',
  },
  {
    sourceColumn: 'habit_id',
    sourceTable: 'habit_entries',
    targetTable: 'habits',
  },
  {
    sourceColumn: 'item_id',
    sourceTable: 'self_care_item_alternatives',
    targetTable: 'self_care_items',
  },
  {
    sourceColumn: 'item_id',
    sourceTable: 'self_care_schedule_rules',
    targetTable: 'self_care_items',
  },
  {
    sourceColumn: 'item_id',
    sourceTable: 'self_care_occurrences',
    targetTable: 'self_care_items',
  },
  {
    sourceColumn: 'schedule_rule_id',
    sourceTable: 'self_care_occurrences',
    targetTable: 'self_care_schedule_rules',
  },
  {
    sourceColumn: 'item_id',
    sourceTable: 'self_care_completions',
    targetTable: 'self_care_items',
  },
  {
    sourceColumn: 'occurrence_id',
    sourceTable: 'self_care_completions',
    targetTable: 'self_care_occurrences',
  },
  {
    sourceColumn: 'item_id',
    sourceTable: 'self_care_ritual_steps',
    targetTable: 'self_care_items',
  },
  {
    sourceColumn: 'completion_id',
    sourceTable: 'self_care_ritual_step_completions',
    targetTable: 'self_care_completions',
  },
  {
    sourceColumn: 'step_id',
    sourceTable: 'self_care_ritual_step_completions',
    targetTable: 'self_care_ritual_steps',
  },
  {
    sourceColumn: 'step_id',
    sourceTable: 'self_care_ritual_step_drafts',
    targetTable: 'self_care_ritual_steps',
  },
  {
    sourceColumn: 'item_id',
    sourceTable: 'self_care_ritual_step_drafts',
    targetTable: 'self_care_items',
  },
  {
    sourceColumn: 'occurrence_id',
    sourceTable: 'self_care_ritual_step_drafts',
    targetTable: 'self_care_occurrences',
  },
  {
    sourceColumn: 'item_id',
    sourceTable: 'self_care_procedure_details',
    targetTable: 'self_care_items',
  },
  {
    sourceColumn: 'item_id',
    sourceTable: 'self_care_appointment_details',
    targetTable: 'self_care_items',
  },
  {
    sourceColumn: 'occurrence_id',
    sourceTable: 'self_care_appointment_details',
    targetTable: 'self_care_occurrences',
  },
  {
    sourceColumn: 'item_id',
    sourceTable: 'self_care_medical_details',
    targetTable: 'self_care_items',
  },
  {
    sourceColumn: 'item_id',
    sourceTable: 'self_care_course_details',
    targetTable: 'self_care_items',
  },
  {
    sourceColumn: 'item_id',
    sourceTable: 'self_care_measurement_details',
    targetTable: 'self_care_items',
  },
  {
    sourceColumn: 'item_id',
    sourceTable: 'self_care_exercise_details',
    targetTable: 'self_care_items',
  },
  {
    sourceColumn: 'linked_item_id',
    sourceTable: 'self_care_minimum_items',
    targetTable: 'self_care_items',
  },
  {
    sourceColumn: 'emoji_set_id',
    sourceTable: 'emoji_assets',
    targetTable: 'emoji_sets',
  },
]

const PUBLIC_ASSET_PATH_PATTERN =
  /\/api\/v1\/(?:icon-assets|profile-assets)\/[A-Za-z0-9][A-Za-z0-9._-]*/g

function getDuplicateIdentifierWarnings(archive: UserBackupArchive): string[] {
  const warnings: string[] = []

  for (const [tableName, rows] of Object.entries(archive.tables)) {
    const identifierColumn =
      tableName === 'cleaning_task_states' ? 'task_id' : 'id'
    const identifiers = new Set<string>()
    let duplicateCount = 0

    for (const row of rows ?? []) {
      const identifier = readStringField(row, identifierColumn)

      if (identifier && identifiers.has(identifier)) {
        duplicateCount += 1
      }

      if (identifier) {
        identifiers.add(identifier)
      }
    }

    if (duplicateCount > 0) {
      warnings.push(
        `Archive table ${tableName} contains ${duplicateCount} duplicate identifier(s).`,
      )
    }
  }

  return warnings
}

function getScopeAnchorWarnings(archive: UserBackupArchive): string[] {
  const warnings: string[] = []
  const hasUser = (archive.tables.users ?? []).some(
    (row) => readStringField(row, 'id') === archive.scope.userId,
  )
  const hasWorkspace = (archive.tables.workspaces ?? []).some(
    (row) => readStringField(row, 'id') === archive.scope.workspaceId,
  )

  if (!hasUser) {
    warnings.push('Archive is missing its scoped user row.')
  }

  if (!hasWorkspace) {
    warnings.push('Archive is missing its scoped workspace row.')
  }

  return warnings
}

function getScopeWarnings(archive: UserBackupArchive): string[] {
  const warnings: string[] = []
  let foreignUserRowCount = 0
  let foreignWorkspaceRowCount = 0

  for (const [tableName, rows] of Object.entries(archive.tables)) {
    for (const row of rows ?? []) {
      if (
        hasForeignScopeValue(row, USER_SCOPE_COLUMNS, archive.scope.userId) ||
        (tableName === 'users' &&
          readStringField(row, 'id') !== archive.scope.userId)
      ) {
        foreignUserRowCount += 1
      }

      if (
        hasForeignScopeValue(
          row,
          WORKSPACE_SCOPE_COLUMNS,
          archive.scope.workspaceId,
        ) ||
        (tableName === 'workspaces' &&
          readStringField(row, 'id') !== archive.scope.workspaceId)
      ) {
        foreignWorkspaceRowCount += 1
      }
    }
  }

  if (foreignUserRowCount > 0) {
    warnings.push(
      `Archive contains ${foreignUserRowCount} row(s) outside its user scope.`,
    )
  }

  if (foreignWorkspaceRowCount > 0) {
    warnings.push(
      `Archive contains ${foreignWorkspaceRowCount} row(s) outside its workspace scope.`,
    )
  }

  return warnings
}

const USER_SCOPE_COLUMNS = [
  'user_id',
  'owner_user_id',
  'created_by',
  'updated_by',
  'assignee_user_id',
  'invited_by',
] as const

const WORKSPACE_SCOPE_COLUMNS = ['workspace_id'] as const

function hasForeignScopeValue(
  row: UserBackupRow,
  columns: readonly string[],
  expectedValue: string,
): boolean {
  return columns.some((column) => {
    const value = row[column]

    return typeof value === 'string' && value !== expectedValue
  })
}

function getReferenceWarnings(archive: UserBackupArchive): string[] {
  const warnings: string[] = []

  for (const rule of REFERENCE_RULES) {
    const missingCount = countMissingReferences(archive, rule)

    if (missingCount > 0) {
      warnings.push(
        `Archive has ${missingCount} row(s) with missing parent references: ${rule.sourceTable}.${rule.sourceColumn} -> ${rule.targetTable}.${rule.targetColumn ?? 'id'}.`,
      )
    }
  }

  return warnings
}

function countMissingReferences(
  archive: UserBackupArchive,
  rule: ReferenceRule,
): number {
  const sourceRows = archive.tables[rule.sourceTable] ?? []
  const targetValues = new Set(
    (archive.tables[rule.targetTable] ?? [])
      .map((row) => readStringField(row, rule.targetColumn ?? 'id'))
      .filter((value): value is string => Boolean(value)),
  )
  let missingCount = 0

  for (const row of sourceRows) {
    const value = readStringField(row, rule.sourceColumn)

    if (value && !targetValues.has(value)) {
      missingCount += 1
    }
  }

  return missingCount
}

function getAssetWarnings(archive: UserBackupArchive): string[] {
  const warnings: string[] = []
  const assetPaths = new Set<string>()
  let duplicateAssetPathCount = 0
  let byteLengthMismatchCount = 0
  let invalidBase64Count = 0
  let contentMismatchCount = 0

  for (const asset of archive.assets) {
    if (assetPaths.has(asset.path)) {
      duplicateAssetPathCount += 1
    }

    assetPaths.add(asset.path)

    const buffer = Buffer.from(asset.base64, 'base64')

    if (buffer.toString('base64') !== asset.base64) {
      invalidBase64Count += 1
    }

    if (buffer.byteLength !== asset.byteLength) {
      byteLengthMismatchCount += 1
    }

    if (!matchesContentType(buffer, asset.contentType)) {
      contentMismatchCount += 1
    }
  }

  const referencedPaths = collectReferencedAssetPaths(archive)
  const missingAssetPayloadCount = [...referencedPaths].filter(
    (path) => !assetPaths.has(path),
  ).length

  if (missingAssetPayloadCount > 0) {
    warnings.push(
      `Archive references ${missingAssetPayloadCount} local asset file(s) without payload.`,
    )
  }

  if (duplicateAssetPathCount > 0) {
    warnings.push(
      `Archive contains ${duplicateAssetPathCount} duplicate asset payload path(s).`,
    )
  }

  if (byteLengthMismatchCount > 0) {
    warnings.push(
      `Archive contains ${byteLengthMismatchCount} asset payload(s) with invalid byte length.`,
    )
  }

  if (invalidBase64Count > 0) {
    warnings.push(
      `Archive contains ${invalidBase64Count} asset payload(s) with non-canonical base64.`,
    )
  }

  if (contentMismatchCount > 0) {
    warnings.push(
      `Archive contains ${contentMismatchCount} asset payload(s) whose bytes do not match content type.`,
    )
  }

  return warnings
}

function getArrayReferenceWarnings(archive: UserBackupArchive): string[] {
  const taskIds = new Set(
    (archive.tables.tasks ?? [])
      .map((row) => readStringField(row, 'id'))
      .filter((value): value is string => Boolean(value)),
  )
  let missingTaskReferenceCount = 0

  for (const plan of archive.tables.daily_plans ?? []) {
    for (const column of [
      'focus_task_ids',
      'routine_task_ids',
      'support_task_ids',
    ]) {
      const values = plan[column]

      if (!Array.isArray(values)) {
        continue
      }

      missingTaskReferenceCount += values.filter(
        (value) => typeof value === 'string' && !taskIds.has(value),
      ).length
    }
  }

  return missingTaskReferenceCount > 0
    ? [
        `Archive has ${missingTaskReferenceCount} missing task reference(s) in daily plan arrays.`,
      ]
    : []
}

function matchesContentType(buffer: Buffer, contentType: string): boolean {
  if (contentType === 'image/png') {
    return buffer.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex'))
  }

  if (contentType === 'image/jpeg') {
    return (
      buffer.length >= 3 &&
      buffer.subarray(0, 3).equals(Buffer.from('ffd8ff', 'hex'))
    )
  }

  if (contentType === 'image/gif') {
    const signature = buffer.subarray(0, 6).toString('ascii')

    return signature === 'GIF87a' || signature === 'GIF89a'
  }

  if (contentType === 'image/webp') {
    return (
      buffer.subarray(0, 4).toString('ascii') === 'RIFF' &&
      buffer.subarray(8, 12).toString('ascii') === 'WEBP'
    )
  }

  return false
}

function collectReferencedAssetPaths(archive: UserBackupArchive): Set<string> {
  const paths = new Set<string>()

  for (const rows of Object.values(archive.tables)) {
    for (const row of rows) {
      collectReferencedAssetPathsFromValue(row, paths)
    }
  }

  return paths
}

function collectReferencedAssetPathsFromValue(
  value: unknown,
  paths: Set<string>,
): void {
  if (typeof value === 'string') {
    for (const match of value.matchAll(PUBLIC_ASSET_PATH_PATTERN)) {
      paths.add(match[0])
    }

    return
  }

  if (Array.isArray(value)) {
    for (const item of value) {
      collectReferencedAssetPathsFromValue(item, paths)
    }

    return
  }

  if (typeof value === 'object' && value !== null) {
    for (const item of Object.values(value)) {
      collectReferencedAssetPathsFromValue(item, paths)
    }
  }
}

function readStringField(row: UserBackupRow, fieldName: string): string | null {
  const value = row[fieldName]

  return typeof value === 'string' && value.trim() ? value : null
}
