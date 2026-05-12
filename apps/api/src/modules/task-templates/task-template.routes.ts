import {
  newTaskTemplateInputSchema,
  taskTemplateListResponseSchema,
  taskTemplateRecordSchema,
} from '@planner/contracts'
import type { FastifyInstance } from 'fastify'
import { z } from 'zod'

import {
  resolveRouteReadContext,
  resolveRouteWriteContext,
} from '../../bootstrap/route-context.js'
import { parseOrThrow } from '../../bootstrap/validation.js'
import type { SessionService } from '../session/index.js'
import type { TaskTemplateService } from './task-template.service.js'

const taskTemplateParamsSchema = z.object({
  templateId: z.string().min(1),
})

export function registerTaskTemplateRoutes(
  app: FastifyInstance,
  sessionService: SessionService,
  service: TaskTemplateService,
): void {
  app.get('/api/v1/task-templates', async (request) => {
    const context = await resolveRouteReadContext(request, sessionService)
    const templates = await service.listTaskTemplates(context)

    return taskTemplateListResponseSchema.parse(templates)
  })

  app.post('/api/v1/task-templates', async (request, reply) => {
    const input = parseOrThrow(
      newTaskTemplateInputSchema,
      request.body,
      'invalid_body',
    )
    const context = await resolveRouteWriteContext(request, sessionService)
    const template = await service.createTaskTemplate(context, input)

    reply.code(201)

    return taskTemplateRecordSchema.parse(template)
  })

  app.delete('/api/v1/task-templates/:templateId', async (request, reply) => {
    const params = parseOrThrow(
      taskTemplateParamsSchema,
      request.params,
      'invalid_params',
    )
    const context = await resolveRouteWriteContext(request, sessionService)

    await service.removeTaskTemplate(context, params.templateId)

    reply.code(204)

    return null
  })
}
