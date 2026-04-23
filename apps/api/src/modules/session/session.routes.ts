import {
  sessionResponseSchema,
  workspaceUserListResponseSchema,
  workspaceUserRecordSchema,
  workspaceUserRoleUpdateInputSchema,
} from '@planner/contracts'
import type { FastifyInstance, FastifyRequest } from 'fastify'
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

const adminAuthHeadersSchema = z.object({
  'x-workspace-id': z.string().min(1),
})

const adminLegacyHeadersSchema = adminAuthHeadersSchema.extend({
  'x-actor-user-id': z.string().min(1),
})

const userParamsSchema = z.object({
  userId: z.string().min(1),
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

  app.get('/api/v1/admin/users', async (request) => {
    const context = resolveAdminSessionContext(request)
    const users = await service.listWorkspaceUsers(context)

    return workspaceUserListResponseSchema.parse({ users })
  })

  app.patch('/api/v1/admin/users/:userId/role', async (request) => {
    const context = resolveAdminSessionContext(request)
    const params = parseOrThrow(
      userParamsSchema,
      request.params,
      'invalid_params',
    )
    const input = parseOrThrow(
      workspaceUserRoleUpdateInputSchema,
      request.body,
      'invalid_body',
    )
    const user = await service.updateWorkspaceUserRole(
      context,
      params.userId,
      input.role,
    )

    return workspaceUserRecordSchema.parse(user)
  })
}

function resolveAdminSessionContext(request: FastifyRequest) {
  const authContext = getRequestAuth(request)

  if (authContext) {
    const headers = parseOrThrow(
      adminAuthHeadersSchema,
      request.headers,
      'invalid_headers',
    )

    return {
      actorUserId: undefined,
      auth: authContext,
      workspaceId: headers['x-workspace-id'],
    }
  }

  const headers = parseOrThrow(
    adminLegacyHeadersSchema,
    request.headers,
    'invalid_headers',
  )

  return {
    actorUserId: headers['x-actor-user-id'],
    auth: null,
    workspaceId: headers['x-workspace-id'],
  }
}
