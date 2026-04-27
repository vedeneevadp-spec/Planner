import {
  lifeSphereListRecordResponseSchema,
  lifeSphereRecordSchema,
  lifeSphereUpdateInputSchema,
  newLifeSphereInputSchema,
  weeklySphereStatsRecordResponseSchema,
} from '@planner/contracts'
import type { FastifyInstance, FastifyRequest } from 'fastify'
import { z } from 'zod'

import { getRequestAuth } from '../../bootstrap/request-auth.js'
import { parseOrThrow } from '../../bootstrap/validation.js'
import type { SessionService } from '../session/index.js'
import type { LifeSphereService } from './life-sphere.service.js'

const readHeadersSchema = z.object({
  'x-workspace-id': z.string().min(1),
})

const writeHeadersSchema = readHeadersSchema.extend({
  'x-actor-user-id': z.string().min(1),
})

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
    const headers = parseOrThrow(
      readHeadersSchema,
      request.headers,
      'invalid_headers',
    )
    const context = await resolveReadContext(request, sessionService, headers)
    const spheres = await service.listSpheres(context)

    return lifeSphereListRecordResponseSchema.parse(spheres)
  })

  app.post('/api/v1/life-spheres', async (request, reply) => {
    const headers = parseHeadersForWrite(request)
    const input = parseOrThrow(
      newLifeSphereInputSchema,
      request.body,
      'invalid_body',
    )
    const context = await resolveWriteContext(request, sessionService, headers)
    const sphere = await service.createSphere(context, input)

    reply.code(201)

    return lifeSphereRecordSchema.parse(sphere)
  })

  app.patch('/api/v1/life-spheres/:sphereId', async (request) => {
    const headers = parseHeadersForWrite(request)
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
    const context = await resolveWriteContext(request, sessionService, headers)
    const sphere = await service.updateSphere(context, params.sphereId, input)

    return lifeSphereRecordSchema.parse(sphere)
  })

  app.delete('/api/v1/life-spheres/:sphereId', async (request, reply) => {
    const headers = parseHeadersForWrite(request)
    const params = parseOrThrow(
      sphereParamsSchema,
      request.params,
      'invalid_params',
    )
    const context = await resolveWriteContext(request, sessionService, headers)

    await service.removeSphere(context, params.sphereId)
    reply.code(204)

    return null
  })

  app.get('/api/v1/life-spheres/weekly-stats', async (request) => {
    const headers = parseOrThrow(
      readHeadersSchema,
      request.headers,
      'invalid_headers',
    )
    const query = parseOrThrow(
      weeklyStatsQuerySchema,
      request.query,
      'invalid_query',
    )
    const context = await resolveReadContext(request, sessionService, headers)
    const result = await service.getWeeklyStats(context, query.from, query.to)

    return weeklySphereStatsRecordResponseSchema.parse(result)
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
