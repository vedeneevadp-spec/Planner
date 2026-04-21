import {
  newTaskTemplateInputSchema,
  taskTemplateListResponseSchema,
  taskTemplateRecordSchema,
} from '@planner/contracts'
import type { FastifyInstance, FastifyRequest } from 'fastify'
import { z } from 'zod'

import { getRequestAuth } from '../../bootstrap/request-auth.js'
import { parseOrThrow } from '../../bootstrap/validation.js'
import type { SessionService } from '../session/index.js'
import type { TaskTemplateService } from './task-template.service.js'

const readHeadersSchema = z.object({
  'x-workspace-id': z.string().min(1),
})

const writeHeadersSchema = readHeadersSchema.extend({
  'x-actor-user-id': z.string().min(1),
})

const taskTemplateParamsSchema = z.object({
  templateId: z.string().min(1),
})

export function registerTaskTemplateRoutes(
  app: FastifyInstance,
  sessionService: SessionService,
  service: TaskTemplateService,
): void {
  app.get('/api/v1/task-templates', async (request) => {
    const headers = parseOrThrow(
      readHeadersSchema,
      request.headers,
      'invalid_headers',
    )
    const context = await resolveReadContext(request, sessionService, headers)
    const templates = await service.listTaskTemplates(context)

    return taskTemplateListResponseSchema.parse(templates)
  })

  app.post('/api/v1/task-templates', async (request, reply) => {
    const headers = parseHeadersForWrite(request)
    const input = parseOrThrow(
      newTaskTemplateInputSchema,
      request.body,
      'invalid_body',
    )
    const context = await resolveWriteContext(request, sessionService, headers)
    const template = await service.createTaskTemplate(context, input)

    reply.code(201)

    return taskTemplateRecordSchema.parse(template)
  })

  app.delete('/api/v1/task-templates/:templateId', async (request, reply) => {
    const headers = parseHeadersForWrite(request)
    const params = parseOrThrow(
      taskTemplateParamsSchema,
      request.params,
      'invalid_params',
    )
    const context = await resolveWriteContext(request, sessionService, headers)

    await service.removeTaskTemplate(context, params.templateId)

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
