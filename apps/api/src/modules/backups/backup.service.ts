import {
  type UserBackupArchive,
  type UserBackupPreviewResponse,
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

  return warnings
}
