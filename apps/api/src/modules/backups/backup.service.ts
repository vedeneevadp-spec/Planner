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

  warnings.push(...getReferenceWarnings(archive))
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
    sourceColumn: 'item_id',
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

  for (const asset of archive.assets) {
    if (assetPaths.has(asset.path)) {
      duplicateAssetPathCount += 1
    }

    assetPaths.add(asset.path)

    if (Buffer.byteLength(asset.base64, 'base64') !== asset.byteLength) {
      byteLengthMismatchCount += 1
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

  return warnings
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
