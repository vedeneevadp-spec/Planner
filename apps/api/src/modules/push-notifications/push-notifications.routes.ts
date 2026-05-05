import {
  pushDeviceRecordSchema,
  pushDeviceUpsertInputSchema,
  pushTestNotificationInputSchema,
  pushTestNotificationResponseSchema,
} from '@planner/contracts'
import type { FastifyInstance, FastifyRequest } from 'fastify'
import { z } from 'zod'

import { getRequestAuth } from '../../bootstrap/request-auth.js'
import { parseOrThrow } from '../../bootstrap/validation.js'
import type { SessionService } from '../session/index.js'
import type { PushNotificationsService } from './push-notifications.service.js'

const readHeadersSchema = z.object({
  'x-workspace-id': z.string().min(1),
})

const writeHeadersSchema = readHeadersSchema.extend({
  'x-actor-user-id': z.string().min(1),
})

const installationParamsSchema = z.object({
  installationId: z.string().min(1),
})

export function registerPushNotificationsRoutes(
  app: FastifyInstance,
  sessionService: SessionService,
  service: PushNotificationsService,
): void {
  app.put('/api/v1/push/devices', async (request) => {
    const headers = parseHeadersForWrite(request)
    const input = parseOrThrow(
      pushDeviceUpsertInputSchema,
      request.body,
      'invalid_body',
    )
    const session = await resolveWriteSession(request, sessionService, headers)
    const device = await service.upsertDevice(session, input)

    return pushDeviceRecordSchema.parse(device)
  })

  app.delete('/api/v1/push/devices/:installationId', async (request, reply) => {
    const headers = parseHeadersForWrite(request)
    const params = parseOrThrow(
      installationParamsSchema,
      request.params,
      'invalid_params',
    )
    const session = await resolveWriteSession(request, sessionService, headers)

    await service.removeDevice(session, params.installationId)

    reply.code(204)

    return null
  })

  app.post('/api/v1/push/test', async (request) => {
    const headers = parseHeadersForWrite(request)
    const input = parseOrThrow(
      pushTestNotificationInputSchema,
      request.body,
      'invalid_body',
    )
    const session = await resolveWriteSession(request, sessionService, headers)
    const result = await service.sendTestNotification(session, input)

    return pushTestNotificationResponseSchema.parse(result)
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

async function resolveWriteSession(
  request: FastifyRequest,
  sessionService: SessionService,
  headers:
    | z.infer<typeof readHeadersSchema>
    | z.infer<typeof writeHeadersSchema>,
) {
  const authContext = getRequestAuth(request)

  if (authContext) {
    return sessionService.resolveSession({
      actorUserId: undefined,
      auth: authContext,
      workspaceId: headers['x-workspace-id'],
    })
  }

  const legacyHeaders = headers as z.infer<typeof writeHeadersSchema>

  return sessionService.resolveSession({
    actorUserId: legacyHeaders['x-actor-user-id'],
    auth: null,
    workspaceId: legacyHeaders['x-workspace-id'],
  })
}
