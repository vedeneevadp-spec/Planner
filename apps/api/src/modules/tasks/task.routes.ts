import {
  newTaskInputSchema,
  taskListFiltersSchema,
  taskListResponseSchema,
  taskRecordSchema,
  taskScheduleUpdateInputSchema,
  taskStatusUpdateInputSchema,
} from '@planner/contracts'
import type { FastifyInstance, FastifyRequest } from 'fastify'
import { z } from 'zod'

import { HttpError } from '../../bootstrap/http-error.js'
import { parseOrThrow } from '../../bootstrap/validation.js'
import type { TaskService } from './task.service.js'

const readHeadersSchema = z.object({
  'x-workspace-id': z.string().min(1),
})

const writeHeadersSchema = readHeadersSchema.extend({
  'x-actor-user-id': z.string().min(1),
})

const taskParamsSchema = z.object({
  taskId: z.string().min(1),
})

export function registerTaskRoutes(
  app: FastifyInstance,
  service: TaskService,
): void {
  app.get('/api/v1/tasks', async (request) => {
    const headers = parseOrThrow(
      readHeadersSchema,
      request.headers,
      'invalid_headers',
    )
    const filters = parseOrThrow(
      taskListFiltersSchema,
      request.query,
      'invalid_query',
    )
    const tasks = await service.listTasks(headers['x-workspace-id'], filters)

    return taskListResponseSchema.parse(tasks)
  })

  app.post('/api/v1/tasks', async (request, reply) => {
    const headers = parseOrThrow(
      writeHeadersSchema,
      request.headers,
      'invalid_headers',
    )
    const input = parseOrThrow(newTaskInputSchema, request.body, 'invalid_body')
    const task = await service.createTask(createWriteContext(headers), input)

    reply.code(201)

    return taskRecordSchema.parse(task)
  })

  app.patch('/api/v1/tasks/:taskId/status', async (request) => {
    const headers = parseOrThrow(
      writeHeadersSchema,
      request.headers,
      'invalid_headers',
    )
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
    const task = await service.setTaskStatus(
      createWriteContext(headers),
      params.taskId,
      body.status,
      body.expectedVersion,
    )

    return taskRecordSchema.parse(task)
  })

  app.patch('/api/v1/tasks/:taskId/schedule', async (request) => {
    const headers = parseOrThrow(
      writeHeadersSchema,
      request.headers,
      'invalid_headers',
    )
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
    const task = await service.setTaskSchedule(
      createWriteContext(headers),
      params.taskId,
      body.schedule,
      body.expectedVersion,
    )

    return taskRecordSchema.parse(task)
  })

  app.delete('/api/v1/tasks/:taskId', async (request, reply) => {
    const headers = parseOrThrow(
      writeHeadersSchema,
      request.headers,
      'invalid_headers',
    )
    const params = parseOrThrow(
      taskParamsSchema,
      request.params,
      'invalid_params',
    )
    const expectedVersion = parseExpectedVersion(request)

    await service.removeTask(
      createWriteContext(headers),
      params.taskId,
      expectedVersion,
    )

    reply.code(204)

    return null
  })
}

function createWriteContext(headers: z.infer<typeof writeHeadersSchema>): {
  actorUserId: string
  workspaceId: string
} {
  return {
    actorUserId: headers['x-actor-user-id'],
    workspaceId: headers['x-workspace-id'],
  }
}

function parseExpectedVersion(request: FastifyRequest): number | undefined {
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
