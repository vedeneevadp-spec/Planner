import {
  newProjectInputSchema,
  projectListResponseSchema,
  projectRecordSchema,
  projectUpdateInputSchema,
} from '@planner/contracts'
import type { FastifyInstance, FastifyRequest } from 'fastify'
import { z } from 'zod'

import { getRequestAuth } from '../../bootstrap/request-auth.js'
import { parseOrThrow } from '../../bootstrap/validation.js'
import type { SessionService } from '../session/index.js'
import type { ProjectService } from './project.service.js'

const readHeadersSchema = z.object({
  'x-workspace-id': z.string().min(1),
})

const writeHeadersSchema = readHeadersSchema.extend({
  'x-actor-user-id': z.string().min(1),
})

const projectParamsSchema = z.object({
  projectId: z.string().min(1),
})

export function registerProjectRoutes(
  app: FastifyInstance,
  sessionService: SessionService,
  service: ProjectService,
): void {
  app.get('/api/v1/projects', async (request) => {
    const headers = parseOrThrow(
      readHeadersSchema,
      request.headers,
      'invalid_headers',
    )
    const context = await resolveReadContext(request, sessionService, headers)
    const projects = await service.listProjects(context)

    return projectListResponseSchema.parse(projects)
  })

  app.get('/api/v1/projects/:projectId', async (request) => {
    const headers = parseOrThrow(
      readHeadersSchema,
      request.headers,
      'invalid_headers',
    )
    const params = parseOrThrow(
      projectParamsSchema,
      request.params,
      'invalid_params',
    )
    const context = await resolveReadContext(request, sessionService, headers)
    const project = await service.getProject(context, params.projectId)

    return projectRecordSchema.parse(project)
  })

  app.post('/api/v1/projects', async (request, reply) => {
    const headers = parseHeadersForWrite(request)
    const input = parseOrThrow(
      newProjectInputSchema,
      request.body,
      'invalid_body',
    )
    const context = await resolveWriteContext(request, sessionService, headers)
    const project = await service.createProject(context, input)

    reply.code(201)

    return projectRecordSchema.parse(project)
  })

  app.patch('/api/v1/projects/:projectId', async (request) => {
    const headers = parseHeadersForWrite(request)
    const params = parseOrThrow(
      projectParamsSchema,
      request.params,
      'invalid_params',
    )
    const body = parseOrThrow(
      projectUpdateInputSchema,
      request.body,
      'invalid_body',
    )
    const context = await resolveWriteContext(request, sessionService, headers)
    const project = await service.updateProject(context, params.projectId, body)

    return projectRecordSchema.parse(project)
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
