import {
  habitEntryDeleteInputSchema,
  habitEntryRecordSchema,
  habitEntryUpsertInputSchema,
  habitListResponseSchema,
  habitRecordSchema,
  habitStatsQuerySchema,
  habitStatsResponseSchema,
  habitTodayQuerySchema,
  habitTodayResponseSchema,
  habitUpdateInputSchema,
  newHabitInputSchema,
} from '@planner/contracts'
import type { FastifyInstance, FastifyRequest } from 'fastify'
import { z } from 'zod'

import { getRequestAuth } from '../../bootstrap/request-auth.js'
import { parseOrThrow } from '../../bootstrap/validation.js'
import type { SessionService } from '../session/index.js'
import type { HabitService } from './habit.service.js'
import { getDateKey } from './habit.shared.js'

const readHeadersSchema = z.object({
  'x-workspace-id': z.string().min(1),
})

const writeHeadersSchema = readHeadersSchema.extend({
  'x-actor-user-id': z.string().min(1),
})

const habitParamsSchema = z.object({
  habitId: z.string().min(1),
})

const habitEntryParamsSchema = habitParamsSchema.extend({
  date: z.string().min(1),
})

export function registerHabitRoutes(
  app: FastifyInstance,
  sessionService: SessionService,
  service: HabitService,
): void {
  app.get('/api/v1/habits', async (request) => {
    const headers = parseOrThrow(
      readHeadersSchema,
      request.headers,
      'invalid_headers',
    )
    const context = await resolveReadContext(request, sessionService, headers)
    const habits = await service.listHabits(context)

    return habitListResponseSchema.parse(habits)
  })

  app.get('/api/v1/habits/today', async (request) => {
    const headers = parseOrThrow(
      readHeadersSchema,
      request.headers,
      'invalid_headers',
    )
    const query = parseOrThrow(
      habitTodayQuerySchema,
      request.query,
      'invalid_query',
    )
    const context = await resolveReadContext(request, sessionService, headers)
    const result = await service.getToday(
      context,
      query.date ?? getDateKey(new Date()),
    )

    return habitTodayResponseSchema.parse(result)
  })

  app.get('/api/v1/habits/stats', async (request) => {
    const headers = parseOrThrow(
      readHeadersSchema,
      request.headers,
      'invalid_headers',
    )
    const query = parseOrThrow(
      habitStatsQuerySchema,
      request.query,
      'invalid_query',
    )
    const context = await resolveReadContext(request, sessionService, headers)
    const result = await service.getStats(context, query.from, query.to)

    return habitStatsResponseSchema.parse(result)
  })

  app.post('/api/v1/habits', async (request, reply) => {
    const headers = parseHeadersForWrite(request)
    const input = parseOrThrow(
      newHabitInputSchema,
      request.body,
      'invalid_body',
    )
    const context = await resolveWriteContext(request, sessionService, headers)
    const habit = await service.createHabit(context, input)

    reply.code(201)

    return habitRecordSchema.parse(habit)
  })

  app.patch('/api/v1/habits/:habitId', async (request) => {
    const headers = parseHeadersForWrite(request)
    const params = parseOrThrow(
      habitParamsSchema,
      request.params,
      'invalid_params',
    )
    const input = parseOrThrow(
      habitUpdateInputSchema,
      request.body,
      'invalid_body',
    )
    const context = await resolveWriteContext(request, sessionService, headers)
    const habit = await service.updateHabit(context, params.habitId, input)

    return habitRecordSchema.parse(habit)
  })

  app.delete('/api/v1/habits/:habitId', async (request, reply) => {
    const headers = parseHeadersForWrite(request)
    const params = parseOrThrow(
      habitParamsSchema,
      request.params,
      'invalid_params',
    )
    const context = await resolveWriteContext(request, sessionService, headers)

    await service.removeHabit(context, params.habitId)

    reply.code(204)

    return null
  })

  app.put('/api/v1/habits/:habitId/entries/:date', async (request) => {
    const headers = parseHeadersForWrite(request)
    const params = parseOrThrow(
      habitEntryParamsSchema,
      request.params,
      'invalid_params',
    )
    const input = parseOrThrow(
      habitEntryUpsertInputSchema,
      {
        ...(isRecord(request.body) ? request.body : {}),
        date: params.date,
      },
      'invalid_body',
    )
    const context = await resolveWriteContext(request, sessionService, headers)
    const entry = await service.upsertEntry(
      context,
      params.habitId,
      params.date,
      input,
    )

    return habitEntryRecordSchema.parse(entry)
  })

  app.delete(
    '/api/v1/habits/:habitId/entries/:date',
    async (request, reply) => {
      const headers = parseHeadersForWrite(request)
      const params = parseOrThrow(
        habitEntryParamsSchema,
        request.params,
        'invalid_params',
      )
      const input = parseOrThrow(
        habitEntryDeleteInputSchema,
        request.body ?? {},
        'invalid_body',
      )
      const context = await resolveWriteContext(
        request,
        sessionService,
        headers,
      )

      await service.removeEntry(
        context,
        params.habitId,
        params.date,
        input.expectedVersion,
      )

      reply.code(204)

      return null
    },
  )
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
