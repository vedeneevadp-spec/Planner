import {
  dailyPlanAutoBuildInputSchema,
  dailyPlanRecordSchema,
  dailyPlanUnloadInputSchema,
  dailyPlanUnloadResponseSchema,
  dailyPlanUpsertInputSchema,
} from '@planner/contracts'
import type { FastifyInstance } from 'fastify'
import { z } from 'zod'

import {
  resolveRouteReadContext,
  resolveRouteWriteContext,
} from '../../bootstrap/route-context.js'
import { parseOrThrow } from '../../bootstrap/validation.js'
import type { SessionService } from '../session/index.js'
import type { DailyPlanService } from './daily-plan.service.js'

const dailyPlanQuerySchema = z.object({
  date: z.string().min(1),
})

export function registerDailyPlanRoutes(
  app: FastifyInstance,
  sessionService: SessionService,
  service: DailyPlanService,
): void {
  app.get('/api/v1/daily-plan', async (request) => {
    const query = parseOrThrow(
      dailyPlanQuerySchema,
      request.query,
      'invalid_query',
    )
    const context = await resolveRouteReadContext(request, sessionService)
    const plan = await service.getPlan(context, query.date)

    return dailyPlanRecordSchema.parse(plan)
  })

  app.put('/api/v1/daily-plan', async (request) => {
    const query = parseOrThrow(
      dailyPlanQuerySchema,
      request.query,
      'invalid_query',
    )
    const input = parseOrThrow(
      dailyPlanUpsertInputSchema,
      request.body,
      'invalid_body',
    )
    const context = await resolveRouteWriteContext(request, sessionService)
    const plan = await service.savePlan(context, query.date, input)

    return dailyPlanRecordSchema.parse(plan)
  })

  app.post('/api/v1/daily-plan/auto-build', async (request) => {
    const input = parseOrThrow(
      dailyPlanAutoBuildInputSchema,
      request.body,
      'invalid_body',
    )
    const context = await resolveRouteWriteContext(request, sessionService)
    const plan = await service.autoBuild(context, input)

    return dailyPlanRecordSchema.parse(plan)
  })

  app.post('/api/v1/daily-plan/unload', async (request) => {
    const input = parseOrThrow(
      dailyPlanUnloadInputSchema,
      request.body,
      'invalid_body',
    )
    const context = await resolveRouteReadContext(request, sessionService)
    const result = await service.unload(context, input.date)

    return dailyPlanUnloadResponseSchema.parse(result)
  })
}
