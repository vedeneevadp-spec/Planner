import {
  chaosInboxBulkUpdateInputSchema,
  chaosInboxConvertToTaskRecordResponseSchema,
  chaosInboxCreatedRecordResponseSchema,
  chaosInboxItemRecordSchema,
  chaosInboxItemUpdateInputSchema,
  chaosInboxListFiltersSchema,
  chaosInboxListRecordResponseSchema,
} from '@planner/contracts'
import type { FastifyInstance, FastifyRequest } from 'fastify'
import { z } from 'zod'

import { getRequestAuth } from '../../bootstrap/request-auth.js'
import { parseOrThrow } from '../../bootstrap/validation.js'
import type { SessionService } from '../session/index.js'
import type { ChaosInboxService } from './chaos-inbox.service.js'

const readHeadersSchema = z.object({
  'x-workspace-id': z.string().min(1),
})

const writeHeadersSchema = readHeadersSchema.extend({
  'x-actor-user-id': z.string().min(1),
})

const itemParamsSchema = z.object({
  id: z.string().min(1),
})

const createBodySchema = z.object({
  items: z
    .array(
      z.object({
        id: z.string().optional(),
        source: z.enum(['manual', 'quick_add', 'widget', 'voice']).default('manual'),
        text: z.string().trim().min(1).max(5000),
      }),
    )
    .min(1)
    .max(100),
})

const idsBodySchema = z.object({
  ids: z.array(z.string().min(1)).min(1).max(200),
})

export function registerChaosInboxRoutes(
  app: FastifyInstance,
  sessionService: SessionService,
  service: ChaosInboxService,
): void {
  app.post('/api/v1/chaos-inbox', async (request, reply) => {
    const headers = parseHeadersForWrite(request)
    const input = parseOrThrow(createBodySchema, request.body, 'invalid_body')
    const context = await resolveWriteContext(request, sessionService, headers)
    const items = await service.createItems(context, input)

    reply.code(201)

    return chaosInboxCreatedRecordResponseSchema.parse({ items })
  })

  app.get('/api/v1/chaos-inbox', async (request) => {
    const headers = parseOrThrow(
      readHeadersSchema,
      request.headers,
      'invalid_headers',
    )
    const filters = parseOrThrow(
      chaosInboxListFiltersSchema,
      request.query,
      'invalid_query',
    )
    const context = await resolveReadContext(request, sessionService, headers)
    const result = await service.listItems(context, filters)

    return chaosInboxListRecordResponseSchema.parse(result)
  })

  app.patch('/api/v1/chaos-inbox/:id', async (request) => {
    const headers = parseHeadersForWrite(request)
    const params = parseOrThrow(itemParamsSchema, request.params, 'invalid_params')
    const input = parseOrThrow(
      chaosInboxItemUpdateInputSchema,
      request.body,
      'invalid_body',
    )
    const context = await resolveWriteContext(request, sessionService, headers)
    const item = await service.updateItem(context, params.id, input)

    return chaosInboxItemRecordSchema.parse(item)
  })

  app.delete('/api/v1/chaos-inbox/:id', async (request, reply) => {
    const headers = parseHeadersForWrite(request)
    const params = parseOrThrow(itemParamsSchema, request.params, 'invalid_params')
    const context = await resolveWriteContext(request, sessionService, headers)

    await service.removeItem(context, params.id)
    reply.code(204)

    return null
  })

  app.post('/api/v1/chaos-inbox/:id/convert-to-task', async (request) => {
    const headers = parseHeadersForWrite(request)
    const params = parseOrThrow(itemParamsSchema, request.params, 'invalid_params')
    const context = await resolveWriteContext(request, sessionService, headers)
    const result = await service.convertToTask(context, params.id)

    return chaosInboxConvertToTaskRecordResponseSchema.parse(result)
  })

  app.post('/api/v1/chaos-inbox/bulk-update', async (request) => {
    const headers = parseHeadersForWrite(request)
    const input = parseOrThrow(
      chaosInboxBulkUpdateInputSchema,
      request.body,
      'invalid_body',
    )
    const context = await resolveWriteContext(request, sessionService, headers)
    const items = await service.bulkUpdate(context, input)

    return chaosInboxCreatedRecordResponseSchema.parse({ items })
  })

  app.post('/api/v1/chaos-inbox/bulk-delete', async (request, reply) => {
    const headers = parseHeadersForWrite(request)
    const body = parseOrThrow(idsBodySchema, request.body, 'invalid_body')
    const context = await resolveWriteContext(request, sessionService, headers)

    await service.bulkRemove(context, body.ids)
    reply.code(204)

    return null
  })

  app.post('/api/v1/chaos-inbox/bulk-convert-to-tasks', async (request) => {
    const headers = parseHeadersForWrite(request)
    const body = parseOrThrow(idsBodySchema, request.body, 'invalid_body')
    const context = await resolveWriteContext(request, sessionService, headers)
    const results = await service.bulkConvertToTasks(context, body.ids)

    return z.array(chaosInboxConvertToTaskRecordResponseSchema).parse(results)
  })
}

function parseHeadersForWrite(request: FastifyRequest) {
  const authContext = getRequestAuth(request)

  return parseOrThrow(
    authContext ? readHeadersSchema : writeHeadersSchema,
    request.headers,
    'invalid_headers',
  )
}

async function resolveReadContext(
  request: FastifyRequest,
  sessionService: SessionService,
  headers: z.infer<typeof readHeadersSchema>,
) {
  const authContext = getRequestAuth(request)

  if (!authContext) {
    return {
      actorUserId: undefined,
      auth: null,
      role: undefined,
      workspaceId: headers['x-workspace-id'],
    }
  }

  const session = await sessionService.resolveSession({
    actorUserId: undefined,
    auth: authContext,
    workspaceId: headers['x-workspace-id'],
  })

  return {
    actorUserId: session.actorUserId,
    auth: authContext,
    groupRole: session.groupRole,
    role: session.role,
    workspaceKind: session.workspace.kind,
    workspaceId: session.workspaceId,
  }
}

async function resolveWriteContext(
  request: FastifyRequest,
  sessionService: SessionService,
  headers:
    | z.infer<typeof readHeadersSchema>
    | z.infer<typeof writeHeadersSchema>,
) {
  const authContext = getRequestAuth(request)

  if (!authContext) {
    const legacyHeaders = headers as z.infer<typeof writeHeadersSchema>
    const session = await sessionService.resolveSession({
      actorUserId: legacyHeaders['x-actor-user-id'],
      auth: null,
      workspaceId: legacyHeaders['x-workspace-id'],
    })

    return {
      actorUserId: session.actorUserId,
      auth: null,
      groupRole: session.groupRole,
      role: session.role,
      workspaceKind: session.workspace.kind,
      workspaceId: session.workspaceId,
    }
  }

  const session = await sessionService.resolveSession({
    actorUserId: undefined,
    auth: authContext,
    workspaceId: headers['x-workspace-id'],
  })

  return {
    actorUserId: session.actorUserId,
    auth: authContext,
    groupRole: session.groupRole,
    role: session.role,
    workspaceKind: session.workspace.kind,
    workspaceId: session.workspaceId,
  }
}
