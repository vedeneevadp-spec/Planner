import {
  plannerSearchQuerySchema,
  plannerSearchResponseSchema,
} from '@planner/contracts'
import type { FastifyInstance } from 'fastify'

import { resolveRouteReadContext } from '../../bootstrap/route-context.js'
import { parseOrThrow } from '../../bootstrap/validation.js'
import type { SessionService } from '../session/index.js'
import {
  type PlannerSearchServices,
  searchPlanner,
} from './planner-search.service.js'

export function registerPlannerSearchRoutes(
  app: FastifyInstance,
  sessionService: SessionService,
  services: PlannerSearchServices,
): void {
  app.get('/api/v1/planner-search', async (request) => {
    const input = parseOrThrow(
      plannerSearchQuerySchema,
      request.query,
      'invalid_query',
    )
    const context = await resolveRouteReadContext(request, sessionService)
    return plannerSearchResponseSchema.parse(
      await searchPlanner(services, context, input),
    )
  })
}
