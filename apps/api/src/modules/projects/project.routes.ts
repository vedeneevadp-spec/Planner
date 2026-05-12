import {
  newProjectInputSchema,
  projectListResponseSchema,
  projectRecordSchema,
  projectUpdateInputSchema,
} from '@planner/contracts'
import type { FastifyInstance } from 'fastify'
import { z } from 'zod'

import {
  resolveRouteReadContext,
  resolveRouteWriteContext,
} from '../../bootstrap/route-context.js'
import { parseOrThrow } from '../../bootstrap/validation.js'
import type { SessionService } from '../session/index.js'
import type { ProjectService } from './project.service.js'

const projectParamsSchema = z.object({
  projectId: z.string().min(1),
})

export function registerProjectRoutes(
  app: FastifyInstance,
  sessionService: SessionService,
  service: ProjectService,
): void {
  app.get('/api/v1/projects', async (request) => {
    const context = await resolveRouteReadContext(request, sessionService)
    const projects = await service.listProjects(context)

    return projectListResponseSchema.parse(projects)
  })

  app.get('/api/v1/projects/:projectId', async (request) => {
    const params = parseOrThrow(
      projectParamsSchema,
      request.params,
      'invalid_params',
    )
    const context = await resolveRouteReadContext(request, sessionService)
    const project = await service.getProject(context, params.projectId)

    return projectRecordSchema.parse(project)
  })

  app.post('/api/v1/projects', async (request, reply) => {
    const input = parseOrThrow(
      newProjectInputSchema,
      request.body,
      'invalid_body',
    )
    const context = await resolveRouteWriteContext(request, sessionService)
    const project = await service.createProject(context, input)

    reply.code(201)

    return projectRecordSchema.parse(project)
  })

  app.patch('/api/v1/projects/:projectId', async (request) => {
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
    const context = await resolveRouteWriteContext(request, sessionService)
    const project = await service.updateProject(context, params.projectId, body)

    return projectRecordSchema.parse(project)
  })
}
