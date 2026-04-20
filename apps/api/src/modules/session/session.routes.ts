import { sessionResponseSchema } from '@planner/contracts'
import type { FastifyInstance } from 'fastify'
import { z } from 'zod'

import { HttpError } from '../../bootstrap/http-error.js'
import { getRequestAuth } from '../../bootstrap/request-auth.js'
import { parseOrThrow } from '../../bootstrap/validation.js'
import type { SessionService } from './session.service.js'

const legacySessionHeadersSchema = z.object({
  'x-actor-user-id': z.string().min(1).optional(),
  'x-workspace-id': z.string().min(1).optional(),
})

const authSessionHeadersSchema = z.object({
  'x-workspace-id': z.string().min(1).optional(),
})

export function registerSessionRoutes(
  app: FastifyInstance,
  service: SessionService,
): void {
  app.get('/api/v1/session', async (request) => {
    const authContext = getRequestAuth(request)

    if (authContext) {
      const headers = parseOrThrow(
        authSessionHeadersSchema,
        request.headers,
        'invalid_headers',
      )
      const session = await service.resolveSession({
        actorUserId: undefined,
        auth: authContext,
        workspaceId: headers['x-workspace-id'],
      })

      return sessionResponseSchema.parse(session)
    }

    const headers = parseOrThrow(
      legacySessionHeadersSchema,
      request.headers,
      'invalid_headers',
    )

    if (
      Boolean(headers['x-actor-user-id']) !== Boolean(headers['x-workspace-id'])
    ) {
      throw new HttpError(
        400,
        'invalid_headers',
        'x-actor-user-id and x-workspace-id must be provided together.',
      )
    }

    const session = await service.resolveSession({
      auth: null,
      actorUserId: headers['x-actor-user-id'],
      workspaceId: headers['x-workspace-id'],
    })

    return sessionResponseSchema.parse(session)
  })
}
