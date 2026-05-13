import {
  cleaningListResponseSchema,
  cleaningTaskActionInputSchema,
  cleaningTaskActionResponseSchema,
  cleaningTaskRecordSchema,
  cleaningTaskUpdateInputSchema,
  cleaningTodayQuerySchema,
  cleaningTodayResponseSchema,
  cleaningZoneRecordSchema,
  cleaningZoneUpdateInputSchema,
  newCleaningTaskInputSchema,
  newCleaningZoneInputSchema,
} from '@planner/contracts'
import type { FastifyInstance } from 'fastify'
import { z } from 'zod'

import {
  resolveRouteReadContext,
  resolveRouteWriteContext,
} from '../../bootstrap/route-context.js'
import { parseOrThrow } from '../../bootstrap/validation.js'
import type { SessionService } from '../session/index.js'
import type { CleaningService } from './cleaning.service.js'
import { getDateKey } from './cleaning.shared.js'

const cleaningZoneParamsSchema = z.object({
  zoneId: z.string().min(1),
})

const cleaningTaskParamsSchema = z.object({
  taskId: z.string().min(1),
})

export function registerCleaningRoutes(
  app: FastifyInstance,
  sessionService: SessionService,
  service: CleaningService,
): void {
  app.get('/api/v1/cleaning', async (request) => {
    const context = await resolveRouteReadContext(request, sessionService)
    const result = await service.listCleaning(context)

    return cleaningListResponseSchema.parse(result)
  })

  app.get('/api/v1/cleaning/today', async (request) => {
    const query = parseOrThrow(
      cleaningTodayQuerySchema,
      request.query,
      'invalid_query',
    )
    const context = await resolveRouteReadContext(request, sessionService)
    const result = await service.getToday(
      context,
      query.date ?? getDateKey(new Date()),
    )

    return cleaningTodayResponseSchema.parse(result)
  })

  app.post('/api/v1/cleaning/zones', async (request, reply) => {
    const input = parseOrThrow(
      newCleaningZoneInputSchema,
      request.body,
      'invalid_body',
    )
    const context = await resolveRouteWriteContext(request, sessionService)
    const zone = await service.createZone(context, input)

    reply.code(201)

    return cleaningZoneRecordSchema.parse(zone)
  })

  app.patch('/api/v1/cleaning/zones/:zoneId', async (request) => {
    const params = parseOrThrow(
      cleaningZoneParamsSchema,
      request.params,
      'invalid_params',
    )
    const input = parseOrThrow(
      cleaningZoneUpdateInputSchema,
      request.body,
      'invalid_body',
    )
    const context = await resolveRouteWriteContext(request, sessionService)
    const zone = await service.updateZone(context, params.zoneId, input)

    return cleaningZoneRecordSchema.parse(zone)
  })

  app.delete('/api/v1/cleaning/zones/:zoneId', async (request, reply) => {
    const params = parseOrThrow(
      cleaningZoneParamsSchema,
      request.params,
      'invalid_params',
    )
    const context = await resolveRouteWriteContext(request, sessionService)

    await service.removeZone(context, params.zoneId)

    reply.code(204)

    return null
  })

  app.post('/api/v1/cleaning/tasks', async (request, reply) => {
    const input = parseOrThrow(
      newCleaningTaskInputSchema,
      request.body,
      'invalid_body',
    )
    const context = await resolveRouteWriteContext(request, sessionService)
    const task = await service.createTask(context, input)

    reply.code(201)

    return cleaningTaskRecordSchema.parse(task)
  })

  app.patch('/api/v1/cleaning/tasks/:taskId', async (request) => {
    const params = parseOrThrow(
      cleaningTaskParamsSchema,
      request.params,
      'invalid_params',
    )
    const input = parseOrThrow(
      cleaningTaskUpdateInputSchema,
      request.body,
      'invalid_body',
    )
    const context = await resolveRouteWriteContext(request, sessionService)
    const task = await service.updateTask(context, params.taskId, input)

    return cleaningTaskRecordSchema.parse(task)
  })

  app.delete('/api/v1/cleaning/tasks/:taskId', async (request, reply) => {
    const params = parseOrThrow(
      cleaningTaskParamsSchema,
      request.params,
      'invalid_params',
    )
    const context = await resolveRouteWriteContext(request, sessionService)

    await service.removeTask(context, params.taskId)

    reply.code(204)

    return null
  })

  app.post('/api/v1/cleaning/tasks/:taskId/complete', async (request) => {
    const params = parseOrThrow(
      cleaningTaskParamsSchema,
      request.params,
      'invalid_params',
    )
    const input = parseOrThrow(
      cleaningTaskActionInputSchema,
      request.body ?? {},
      'invalid_body',
    )
    const context = await resolveRouteWriteContext(request, sessionService)
    const result = await service.completeTask(context, params.taskId, input)

    return cleaningTaskActionResponseSchema.parse(result)
  })

  app.post('/api/v1/cleaning/tasks/:taskId/postpone', async (request) => {
    const params = parseOrThrow(
      cleaningTaskParamsSchema,
      request.params,
      'invalid_params',
    )
    const input = parseOrThrow(
      cleaningTaskActionInputSchema,
      request.body ?? {},
      'invalid_body',
    )
    const context = await resolveRouteWriteContext(request, sessionService)
    const result = await service.postponeTask(context, params.taskId, input)

    return cleaningTaskActionResponseSchema.parse(result)
  })

  app.post('/api/v1/cleaning/tasks/:taskId/skip', async (request) => {
    const params = parseOrThrow(
      cleaningTaskParamsSchema,
      request.params,
      'invalid_params',
    )
    const input = parseOrThrow(
      cleaningTaskActionInputSchema,
      request.body ?? {},
      'invalid_body',
    )
    const context = await resolveRouteWriteContext(request, sessionService)
    const result = await service.skipTask(context, params.taskId, input)

    return cleaningTaskActionResponseSchema.parse(result)
  })
}
