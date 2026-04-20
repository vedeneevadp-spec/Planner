import {
  newTaskInputSchema,
  taskEventListFiltersSchema,
  taskEventListResponseSchema,
  taskListFiltersSchema,
  taskListResponseSchema,
  taskRecordSchema,
  taskScheduleUpdateInputSchema,
  taskStatusUpdateInputSchema,
} from '@planner/contracts'
import type { FastifyInstance, FastifyRequest } from 'fastify'
import { z } from 'zod'

import { HttpError } from '../../bootstrap/http-error.js'
import { getRequestAuth } from '../../bootstrap/request-auth.js'
import { parseOrThrow } from '../../bootstrap/validation.js'
import type { SessionService } from '../session/index.js'
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
  sessionService: SessionService,
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
    const context = await resolveReadContext(request, sessionService, headers)
    const tasks = await service.listTasks(context, filters)

    return taskListResponseSchema.parse(tasks)
  })

  app.get('/api/v1/task-events', async (request) => {
    const headers = parseOrThrow(
      readHeadersSchema,
      request.headers,
      'invalid_headers',
    )
    const filters = parseOrThrow(
      taskEventListFiltersSchema,
      request.query,
      'invalid_query',
    )
    const context = await resolveReadContext(request, sessionService, headers)
    const result = await service.listTaskEvents(context, filters)

    return taskEventListResponseSchema.parse(result)
  })

  app.post('/api/v1/tasks', async (request, reply) => {
    const headers = parseHeadersForWrite(request)
    const input = parseOrThrow(newTaskInputSchema, request.body, 'invalid_body')
    const context = await resolveWriteContext(request, sessionService, headers)
    const task = await service.createTask(context, input)

    reply.code(201)

    return taskRecordSchema.parse(task)
  })

  app.patch('/api/v1/tasks/:taskId/status', async (request) => {
    const headers = parseHeadersForWrite(request)
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
    const context = await resolveWriteContext(request, sessionService, headers)
    const task = await service.setTaskStatus(
      context,
      params.taskId,
      body.status,
      body.expectedVersion,
    )

    return taskRecordSchema.parse(task)
  })

  app.patch('/api/v1/tasks/:taskId/schedule', async (request) => {
    const headers = parseHeadersForWrite(request)
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
    const context = await resolveWriteContext(request, sessionService, headers)
    const task = await service.setTaskSchedule(
      context,
      params.taskId,
      body.schedule,
      body.expectedVersion,
    )

    return taskRecordSchema.parse(task)
  })

  app.delete('/api/v1/tasks/:taskId', async (request, reply) => {
    const headers = parseHeadersForWrite(request)
    const params = parseOrThrow(
      taskParamsSchema,
      request.params,
      'invalid_params',
    )
    const expectedVersion = parseExpectedVersion(request)
    const context = await resolveWriteContext(request, sessionService, headers)

    await service.removeTask(context, params.taskId, expectedVersion)

    reply.code(204)

    return null
  })
}

function createLegacyWriteContext(headers: z.infer<typeof writeHeadersSchema>) {
  return {
    actorUserId: headers['x-actor-user-id'],
    auth: null,
    role: undefined,
    workspaceId: headers['x-workspace-id'],
  }
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
    role: session.role,
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
    return createLegacyWriteContext(
      headers as z.infer<typeof writeHeadersSchema>,
    )
  }

  const session = await sessionService.resolveSession({
    actorUserId: undefined,
    auth: authContext,
    workspaceId: headers['x-workspace-id'],
  })

  return {
    actorUserId: session.actorUserId,
    auth: authContext,
    role: session.role,
    workspaceId: session.workspaceId,
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
