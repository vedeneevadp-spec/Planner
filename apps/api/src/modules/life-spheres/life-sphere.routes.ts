import {
  lifeSphereListRecordResponseSchema,
  lifeSphereRecordSchema,
  lifeSphereUpdateInputSchema,
  newLifeSphereInputSchema,
  weeklySphereStatsRecordResponseSchema,
} from '@planner/contracts'
import type { FastifyInstance } from 'fastify'
import { z } from 'zod'

import {
  resolveRouteReadContext,
  resolveRouteWriteContext,
} from '../../bootstrap/route-context.js'
import { parseOrThrow } from '../../bootstrap/validation.js'
import type { SessionService } from '../session/index.js'
import type { LifeSphereService } from './life-sphere.service.js'

const sphereParamsSchema = z.object({
  sphereId: z.string().min(1),
})

const weeklyStatsQuerySchema = z.object({
  from: z.string().min(1),
  to: z.string().min(1),
})

export function registerLifeSphereRoutes(
  app: FastifyInstance,
  sessionService: SessionService,
  service: LifeSphereService,
): void {
  app.get('/api/v1/life-spheres', async (request) => {
    const context = await resolveRouteReadContext(request, sessionService)
    const spheres = await service.listSpheres(context)

    return lifeSphereListRecordResponseSchema.parse(spheres)
  })

  app.get('/api/v1/life-spheres/:sphereId', async (request) => {
    const params = parseOrThrow(
      sphereParamsSchema,
      request.params,
      'invalid_params',
    )
    const context = await resolveRouteReadContext(request, sessionService)
    const sphere = await service.getSphere(context, params.sphereId)

    return lifeSphereRecordSchema.parse(sphere)
  })

  app.post('/api/v1/life-spheres', async (request, reply) => {
    const input = parseOrThrow(
      newLifeSphereInputSchema,
      request.body,
      'invalid_body',
    )
    const context = await resolveRouteWriteContext(request, sessionService)
    const sphere = await service.createSphere(context, input)

    reply.code(201)

    return lifeSphereRecordSchema.parse(sphere)
  })

  app.patch('/api/v1/life-spheres/:sphereId', async (request) => {
    const params = parseOrThrow(
      sphereParamsSchema,
      request.params,
      'invalid_params',
    )
    const input = parseOrThrow(
      lifeSphereUpdateInputSchema,
      request.body,
      'invalid_body',
    )
    const context = await resolveRouteWriteContext(request, sessionService)
    const sphere = await service.updateSphere(context, params.sphereId, input)

    return lifeSphereRecordSchema.parse(sphere)
  })

  app.delete('/api/v1/life-spheres/:sphereId', async (request, reply) => {
    const params = parseOrThrow(
      sphereParamsSchema,
      request.params,
      'invalid_params',
    )
    const context = await resolveRouteWriteContext(request, sessionService)

    await service.removeSphere(context, params.sphereId)
    reply.code(204)

    return null
  })

  app.get('/api/v1/life-spheres/weekly-stats', async (request) => {
    const query = parseOrThrow(
      weeklyStatsQuerySchema,
      request.query,
      'invalid_query',
    )
    const context = await resolveRouteReadContext(request, sessionService)
    const result = await service.getWeeklyStats(context, query.from, query.to)

    return weeklySphereStatsRecordResponseSchema.parse(result)
  })
}
