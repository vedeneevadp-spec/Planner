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
import type { FastifyInstance } from 'fastify'
import { z } from 'zod'

import {
  resolveRouteReadContext,
  resolveRouteWriteContext,
} from '../../bootstrap/route-context.js'
import { parseOrThrow } from '../../bootstrap/validation.js'
import type { SessionService } from '../session/index.js'
import type { HabitService } from './habit.service.js'
import { getDateKey } from './habit.shared.js'

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
    const context = await resolveRouteReadContext(request, sessionService)
    const habits = await service.listHabits(context)

    return habitListResponseSchema.parse(habits)
  })

  app.get('/api/v1/habits/today', async (request) => {
    const query = parseOrThrow(
      habitTodayQuerySchema,
      request.query,
      'invalid_query',
    )
    const context = await resolveRouteReadContext(request, sessionService)
    const result = await service.getToday(
      context,
      query.date ?? getDateKey(new Date()),
    )

    return habitTodayResponseSchema.parse(result)
  })

  app.get('/api/v1/habits/stats', async (request) => {
    const query = parseOrThrow(
      habitStatsQuerySchema,
      request.query,
      'invalid_query',
    )
    const context = await resolveRouteReadContext(request, sessionService)
    const result = await service.getStats(context, query.from, query.to)

    return habitStatsResponseSchema.parse(result)
  })

  app.post('/api/v1/habits', async (request, reply) => {
    const input = parseOrThrow(
      newHabitInputSchema,
      request.body,
      'invalid_body',
    )
    const context = await resolveRouteWriteContext(request, sessionService)
    const habit = await service.createHabit(context, input)

    reply.code(201)

    return habitRecordSchema.parse(habit)
  })

  app.patch('/api/v1/habits/:habitId', async (request) => {
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
    const context = await resolveRouteWriteContext(request, sessionService)
    const habit = await service.updateHabit(context, params.habitId, input)

    return habitRecordSchema.parse(habit)
  })

  app.delete('/api/v1/habits/:habitId', async (request, reply) => {
    const params = parseOrThrow(
      habitParamsSchema,
      request.params,
      'invalid_params',
    )
    const context = await resolveRouteWriteContext(request, sessionService)

    await service.removeHabit(context, params.habitId)

    reply.code(204)

    return null
  })

  app.put('/api/v1/habits/:habitId/entries/:date', async (request) => {
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
    const context = await resolveRouteWriteContext(request, sessionService)
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
      const context = await resolveRouteWriteContext(request, sessionService)

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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
