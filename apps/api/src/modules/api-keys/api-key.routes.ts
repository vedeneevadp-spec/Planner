import {
  apiKeyListResponseSchema,
  createApiKeyInputSchema,
  createdApiKeyResponseSchema,
} from '@planner/contracts'
import type { FastifyInstance, FastifyRequest } from 'fastify'
import { z } from 'zod'

import { HttpError } from '../../bootstrap/http-error.js'
import { requireRequestAuth } from '../../bootstrap/request-auth.js'
import { resolveRouteWriteContext } from '../../bootstrap/route-context.js'
import { parseOrThrow } from '../../bootstrap/validation.js'
import { canWriteWorkspaceContent } from '../../shared/workspace-access.js'
import type { SessionService } from '../session/index.js'
import type { ApiKeyService } from './api-key.service.js'

export function registerApiKeyRoutes(
  app: FastifyInstance,
  service: ApiKeyService,
  sessions: SessionService,
) {
  async function owner(request: FastifyRequest) {
    const auth = requireRequestAuth(request)
    const session = await sessions.resolveSession({
      auth,
      actorUserId: undefined,
      workspaceId: undefined,
    })
    return { auth, userId: session.actorUserId }
  }
  app.get('/api/v1/api-keys', async (request, reply) => {
    reply.header('Cache-Control', 'no-store')
    return apiKeyListResponseSchema.parse({
      keys: await service.list(await owner(request)),
    })
  })
  app.post('/api/v1/api-keys', async (request, reply) => {
    reply.header('Cache-Control', 'no-store')
    const auth = requireRequestAuth(request)
    const input = parseOrThrow(
      createApiKeyInputSchema,
      request.body,
      'invalid_body',
    )
    const context = await resolveRouteWriteContext(request, sessions)
    if (
      input.scopes.some((scope) => scope.endsWith(':write')) &&
      !canWriteWorkspaceContent(context)
    ) {
      throw new HttpError(
        403,
        'workspace_write_forbidden',
        'В этом пространстве вам доступно только чтение.',
      )
    }
    const result = await service.create(
      { auth, userId: context.actorUserId },
      context.workspaceId,
      input,
    )
    reply.code(201)
    return createdApiKeyResponseSchema.parse(result)
  })
  app.delete('/api/v1/api-keys/:id', async (request, reply) => {
    reply.header('Cache-Control', 'no-store')
    const { id } = parseOrThrow(
      z.object({ id: z.string().uuid() }),
      request.params,
      'invalid_params',
    )
    await service.revoke(await owner(request), id)
    return reply.code(204).send()
  })
}
