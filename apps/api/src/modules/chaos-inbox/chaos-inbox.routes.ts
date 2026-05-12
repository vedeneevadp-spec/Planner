import {
  chaosInboxBulkUpdateInputSchema,
  chaosInboxConvertToTaskRecordResponseSchema,
  chaosInboxCreatedRecordResponseSchema,
  chaosInboxItemRecordSchema,
  chaosInboxItemUpdateInputSchema,
  chaosInboxListFiltersSchema,
  chaosInboxListRecordResponseSchema,
  createChaosInboxItemsInputSchema,
} from '@planner/contracts'
import type { FastifyInstance } from 'fastify'
import { z } from 'zod'

import {
  resolveRouteReadContext,
  resolveRouteWriteContext,
} from '../../bootstrap/route-context.js'
import { parseOrThrow } from '../../bootstrap/validation.js'
import type { SessionService } from '../session/index.js'
import type { ChaosInboxService } from './chaos-inbox.service.js'

const itemParamsSchema = z.object({
  id: z.string().min(1),
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
    const input = parseOrThrow(
      createChaosInboxItemsInputSchema,
      request.body,
      'invalid_body',
    )
    const context = await resolveRouteWriteContext(request, sessionService)
    const items = await service.createItems(context, input)

    reply.code(201)

    return chaosInboxCreatedRecordResponseSchema.parse({ items })
  })

  app.get('/api/v1/chaos-inbox', async (request) => {
    const filters = parseOrThrow(
      chaosInboxListFiltersSchema,
      request.query,
      'invalid_query',
    )
    const context = await resolveRouteReadContext(request, sessionService)
    const result = await service.listItems(context, filters)

    return chaosInboxListRecordResponseSchema.parse(result)
  })

  app.patch('/api/v1/chaos-inbox/:id', async (request) => {
    const params = parseOrThrow(
      itemParamsSchema,
      request.params,
      'invalid_params',
    )
    const input = parseOrThrow(
      chaosInboxItemUpdateInputSchema,
      request.body,
      'invalid_body',
    )
    const context = await resolveRouteWriteContext(request, sessionService)
    const item = await service.updateItem(context, params.id, input)

    return chaosInboxItemRecordSchema.parse(item)
  })

  app.delete('/api/v1/chaos-inbox/:id', async (request, reply) => {
    const params = parseOrThrow(
      itemParamsSchema,
      request.params,
      'invalid_params',
    )
    const context = await resolveRouteWriteContext(request, sessionService)

    await service.removeItem(context, params.id)
    reply.code(204)

    return null
  })

  app.post('/api/v1/chaos-inbox/:id/convert-to-task', async (request) => {
    const params = parseOrThrow(
      itemParamsSchema,
      request.params,
      'invalid_params',
    )
    const context = await resolveRouteWriteContext(request, sessionService)
    const result = await service.convertToTask(context, params.id)

    return chaosInboxConvertToTaskRecordResponseSchema.parse(result)
  })

  app.post('/api/v1/chaos-inbox/bulk-update', async (request) => {
    const input = parseOrThrow(
      chaosInboxBulkUpdateInputSchema,
      request.body,
      'invalid_body',
    )
    const context = await resolveRouteWriteContext(request, sessionService)
    const items = await service.bulkUpdate(context, input)

    return chaosInboxCreatedRecordResponseSchema.parse({ items })
  })

  app.post('/api/v1/chaos-inbox/bulk-delete', async (request, reply) => {
    const body = parseOrThrow(idsBodySchema, request.body, 'invalid_body')
    const context = await resolveRouteWriteContext(request, sessionService)

    await service.bulkRemove(context, body.ids)
    reply.code(204)

    return null
  })

  app.post('/api/v1/chaos-inbox/bulk-convert-to-tasks', async (request) => {
    const body = parseOrThrow(idsBodySchema, request.body, 'invalid_body')
    const context = await resolveRouteWriteContext(request, sessionService)
    const results = await service.bulkConvertToTasks(context, body.ids)

    return z.array(chaosInboxConvertToTaskRecordResponseSchema).parse(results)
  })
}
