import Fastify, { type FastifyInstance } from 'fastify'

import { HttpError, isHttpError } from '../../bootstrap/http-error.js'
import type { DatabaseConnection } from '../../infrastructure/db/client.js'
import { pingDatabase } from '../../infrastructure/db/client.js'
import type { UserBackupRestoreExecutor } from './backup.restore-executor.js'
import {
  parseUserBackupRestoreHelperBody,
  USER_BACKUP_RESTORE_HELPER_BODY_LIMIT,
  USER_BACKUP_RESTORE_SIGNATURE_HEADER,
  USER_BACKUP_RESTORE_TIMESTAMP_HEADER,
  verifyUserBackupRestoreSignature,
} from './backup.restore-helper.js'

interface BuildUserBackupRestoreHelperAppInput {
  database: DatabaseConnection
  executor: UserBackupRestoreExecutor
  secret: string
}

export function buildUserBackupRestoreHelperApp({
  database,
  executor,
  secret,
}: BuildUserBackupRestoreHelperAppInput): FastifyInstance {
  const app = Fastify({
    bodyLimit: USER_BACKUP_RESTORE_HELPER_BODY_LIMIT,
    logger: true,
  })

  app.addContentTypeParser(
    'application/json',
    { parseAs: 'buffer' },
    (_request, body, done) => {
      done(null, body)
    },
  )

  app.get('/internal/ready', async () => {
    await pingDatabase(database)

    return { status: 'ready' }
  })

  app.post('/internal/user-backup/restore', async (request) => {
    if (!Buffer.isBuffer(request.body)) {
      throw new HttpError(
        415,
        'backup_restore_helper_media_type_required',
        'Backup restore helper accepts JSON requests only.',
      )
    }

    verifyUserBackupRestoreSignature({
      body: request.body,
      secret,
      signature: readHeader(
        request.headers[USER_BACKUP_RESTORE_SIGNATURE_HEADER],
      ),
      timestamp: readHeader(
        request.headers[USER_BACKUP_RESTORE_TIMESTAMP_HEADER],
      ),
    })
    const input = parseUserBackupRestoreHelperBody(request.body)

    return executor.restorePersonalWorkspace(input)
  })

  app.setErrorHandler((error, request, reply) => {
    const httpError = isHttpError(error)
      ? error
      : new HttpError(500, 'internal_error', 'Internal server error.')

    if (!isHttpError(error)) {
      request.log.error(error)
    }

    void reply.status(httpError.statusCode).send({
      error: {
        code: httpError.code,
        ...(httpError.details === undefined
          ? {}
          : { details: httpError.details }),
        message: httpError.message,
      },
    })
  })

  return app
}

function readHeader(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value
}
