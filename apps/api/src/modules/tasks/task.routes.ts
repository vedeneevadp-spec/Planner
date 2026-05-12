import {
  newTaskInputSchema,
  taskDetailsUpdateInputSchema,
  taskEventListFiltersSchema,
  taskEventListResponseSchema,
  taskListFiltersSchema,
  taskListPageResponseSchema,
  taskListResponseSchema,
  taskRecordSchema,
  taskScheduleUpdateInputSchema,
  taskStatusUpdateInputSchema,
} from '@planner/contracts'
import type { FastifyInstance } from 'fastify'
import { z } from 'zod'

import { HttpError } from '../../bootstrap/http-error.js'
import {
  resolveRouteReadContext,
  resolveRouteWriteContext,
} from '../../bootstrap/route-context.js'
import { parseOrThrow } from '../../bootstrap/validation.js'
import type { SessionService } from '../session/index.js'
import type { TaskService } from './task.service.js'

const taskParamsSchema = z.object({
  taskId: z.string().min(1),
})

export function registerTaskRoutes(
  app: FastifyInstance,
  sessionService: SessionService,
  service: TaskService,
): void {
  app.get('/api/v1/tasks', async (request) => {
    const filters = parseOrThrow(
      taskListFiltersSchema,
      request.query,
      'invalid_query',
    )
    const context = await resolveRouteReadContext(request, sessionService)
    const tasks = await service.listTasks(context, filters)

    return taskListResponseSchema.parse(tasks)
  })

  app.get('/api/v1/tasks/page', async (request) => {
    const filters = parseOrThrow(
      taskListFiltersSchema,
      request.query,
      'invalid_query',
    )
    const context = await resolveRouteReadContext(request, sessionService)
    const result = await service.listTaskPage(context, filters)

    return taskListPageResponseSchema.parse(result)
  })

  app.get('/api/v1/task-events', async (request) => {
    const filters = parseOrThrow(
      taskEventListFiltersSchema,
      request.query,
      'invalid_query',
    )
    const context = await resolveRouteReadContext(request, sessionService)
    const result = await service.listTaskEvents(context, filters)

    return taskEventListResponseSchema.parse(result)
  })

  app.post('/api/v1/tasks', async (request, reply) => {
    const input = parseOrThrow(newTaskInputSchema, request.body, 'invalid_body')
    const context = await resolveRouteWriteContext(request, sessionService)
    const task = await service.createTask(context, input)

    reply.code(201)

    return taskRecordSchema.parse(task)
  })

  app.patch('/api/v1/tasks/:taskId', async (request) => {
    const params = parseOrThrow(
      taskParamsSchema,
      request.params,
      'invalid_params',
    )
    const input = parseOrThrow(
      taskDetailsUpdateInputSchema,
      request.body,
      'invalid_body',
    )
    const context = await resolveRouteWriteContext(request, sessionService)
    const task = await service.updateTask(context, params.taskId, input)

    return taskRecordSchema.parse(task)
  })

  app.patch('/api/v1/tasks/:taskId/status', async (request) => {
    const params = parseOrThrow(
      taskParamsSchema,
      request.params,
      'invalid_params',
    )
    const body = parseOrThrow(
      taskStatusUpdateInputSchema,
      request.body,
      'invalid_body',
    )
    const context = await resolveRouteWriteContext(request, sessionService)
    const task = await service.setTaskStatus(
      context,
      params.taskId,
      body.status,
      body.expectedVersion,
    )

    return taskRecordSchema.parse(task)
  })

  app.patch('/api/v1/tasks/:taskId/schedule', async (request) => {
    const params = parseOrThrow(
      taskParamsSchema,
      request.params,
      'invalid_params',
    )
    const body = parseOrThrow(
      taskScheduleUpdateInputSchema,
      request.body,
      'invalid_body',
    )
    const context = await resolveRouteWriteContext(request, sessionService)
    const task = await service.setTaskSchedule(
      context,
      params.taskId,
      body.schedule,
      body.expectedVersion,
    )

    return taskRecordSchema.parse(task)
  })

  app.delete('/api/v1/tasks/:taskId', async (request, reply) => {
    const params = parseOrThrow(
      taskParamsSchema,
      request.params,
      'invalid_params',
    )
    const expectedVersion = parseExpectedVersion(request)
    const context = await resolveRouteWriteContext(request, sessionService)

    await service.removeTask(context, params.taskId, expectedVersion)

    reply.code(204)

    return null
  })
}

function parseExpectedVersion(request: { query: unknown }): number | undefined {
  const query = request.query as { expectedVersion?: string } | undefined

  if (!query?.expectedVersion) {
    return undefined
  }

  const parsedVersion = Number(query.expectedVersion)

  if (!Number.isInteger(parsedVersion) || parsedVersion <= 0) {
    throw new HttpError(
      400,
      'invalid_query',
      'expectedVersion must be a positive integer when provided.',
    )
  }

  return parsedVersion
}
