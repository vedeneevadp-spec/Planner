import {
  USER_BACKUP_MAX_REQUEST_BYTES,
  userBackupArchiveSchema,
  userBackupPreviewResponseSchema,
  userBackupRestoreRequestSchema,
  userBackupRestoreResponseSchema,
} from '@planner/contracts/backup'
import type { FastifyInstance } from 'fastify'

import { resolveRouteReadContext } from '../../bootstrap/route-context.js'
import { parseOrThrow } from '../../bootstrap/validation.js'
import type { SessionService } from '../session/index.js'
import type { UserBackupService } from './backup.service.js'

export function registerUserBackupRoutes(
  app: FastifyInstance,
  sessionService: SessionService,
  service: UserBackupService,
): void {
  app.get('/api/v1/backups/export', async (request, reply) => {
    const context = await resolveRouteReadContext(request, sessionService)
    const archive = await service.exportBackup(context)
    const body = JSON.stringify(archive, null, 2)
    const fileName = buildBackupFileName(archive.exportedAt)

    reply
      .type('application/json; charset=utf-8')
      .header('content-disposition', `attachment; filename="${fileName}"`)
      .header('content-length', Buffer.byteLength(body))

    return body
  })

  app.post(
    '/api/v1/backups/import/preview',
    {
      bodyLimit: USER_BACKUP_MAX_REQUEST_BYTES,
    },
    async (request) => {
      const context = await resolveRouteReadContext(request, sessionService)
      const archive = parseOrThrow(
        userBackupArchiveSchema,
        request.body,
        'invalid_backup_archive',
      )
      const result = service.previewImport(context, archive)

      return userBackupPreviewResponseSchema.parse(result)
    },
  )

  app.post(
    '/api/v1/backups/import/restore',
    {
      bodyLimit: USER_BACKUP_MAX_REQUEST_BYTES + 1024,
    },
    async (request) => {
      const context = await resolveRouteReadContext(request, sessionService)
      const restoreRequest = parseOrThrow(
        userBackupRestoreRequestSchema,
        request.body,
        'invalid_backup_restore_request',
      )
      const rawIdempotencyKey = request.headers['idempotency-key']
      const idempotencyKey = Array.isArray(rawIdempotencyKey)
        ? rawIdempotencyKey[0]
        : rawIdempotencyKey
      const result = await service.restoreImport(
        context,
        restoreRequest,
        idempotencyKey ?? '',
      )

      return userBackupRestoreResponseSchema.parse(result)
    },
  )
}

function buildBackupFileName(exportedAt: string): string {
  const timestamp = exportedAt
    .replaceAll(/[:.]/g, '-')
    .replaceAll(/[^0-9A-Za-z_-]/g, '-')

  return `planner-backup-${timestamp}.json`
}
