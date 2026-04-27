import {
  dailyPlanAutoBuildInputSchema,
  dailyPlanRecordSchema,
  dailyPlanUnloadInputSchema,
  dailyPlanUnloadResponseSchema,
  dailyPlanUpsertInputSchema,
} from '@planner/contracts'
import type { FastifyInstance, FastifyRequest } from 'fastify'
import { z } from 'zod'

import { getRequestAuth } from '../../bootstrap/request-auth.js'
import { parseOrThrow } from '../../bootstrap/validation.js'
import type { SessionService } from '../session/index.js'
import type { DailyPlanService } from './daily-plan.service.js'

const readHeadersSchema = z.object({
  'x-workspace-id': z.string().min(1),
})

const writeHeadersSchema = readHeadersSchema.extend({
  'x-actor-user-id': z.string().min(1),
})

const dailyPlanQuerySchema = z.object({
  date: z.string().min(1),
})

export function registerDailyPlanRoutes(
  app: FastifyInstance,
  sessionService: SessionService,
  service: DailyPlanService,
): void {
  app.get('/api/v1/daily-plan', async (request) => {
    const headers = parseOrThrow(
      readHeadersSchema,
      request.headers,
      'invalid_headers',
    )
    const query = parseOrThrow(
      dailyPlanQuerySchema,
      request.query,
      'invalid_query',
    )
    const context = await resolveReadContext(request, sessionService, headers)
    const plan = await service.getPlan(context, query.date)

    return dailyPlanRecordSchema.parse(plan)
  })

  app.put('/api/v1/daily-plan', async (request) => {
    const headers = parseHeadersForWrite(request)
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
    const context = await resolveWriteContext(request, sessionService, headers)
    const plan = await service.savePlan(context, query.date, input)

    return dailyPlanRecordSchema.parse(plan)
  })

  app.post('/api/v1/daily-plan/auto-build', async (request) => {
    const headers = parseHeadersForWrite(request)
    const input = parseOrThrow(
      dailyPlanAutoBuildInputSchema,
      request.body,
      'invalid_body',
    )
    const context = await resolveWriteContext(request, sessionService, headers)
    const plan = await service.autoBuild(context, input)

    return dailyPlanRecordSchema.parse(plan)
  })

  app.post('/api/v1/daily-plan/unload', async (request) => {
    const headers = parseOrThrow(
      readHeadersSchema,
      request.headers,
      'invalid_headers',
    )
    const input = parseOrThrow(
      dailyPlanUnloadInputSchema,
      request.body,
      'invalid_body',
    )
    const context = await resolveReadContext(request, sessionService, headers)
    const result = await service.unload(context, input.date)

    return dailyPlanUnloadResponseSchema.parse(result)
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
