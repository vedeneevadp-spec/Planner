import {
  pushDeviceRecordSchema,
  pushDeviceUpsertInputSchema,
  pushTestNotificationInputSchema,
  pushTestNotificationResponseSchema,
} from '@planner/contracts'
import type { FastifyInstance } from 'fastify'
import { z } from 'zod'

import { resolveRouteWriteContext } from '../../bootstrap/route-context.js'
import { parseOrThrow } from '../../bootstrap/validation.js'
import type { SessionService } from '../session/index.js'
import type { PushNotificationsService } from './push-notifications.service.js'

const installationParamsSchema = z.object({
  installationId: z.string().min(1),
})

export function registerPushNotificationsRoutes(
  app: FastifyInstance,
  sessionService: SessionService,
  service: PushNotificationsService,
): void {
  app.put('/api/v1/push/devices', async (request) => {
    const input = parseOrThrow(
      pushDeviceUpsertInputSchema,
      request.body,
      'invalid_body',
    )
    const session = await resolveRouteWriteContext(request, sessionService)
    const device = await service.upsertDevice(session, input)

    return pushDeviceRecordSchema.parse(device)
  })

  app.delete('/api/v1/push/devices/:installationId', async (request, reply) => {
    const params = parseOrThrow(
      installationParamsSchema,
      request.params,
      'invalid_params',
    )
    const session = await resolveRouteWriteContext(request, sessionService)

    await service.removeDevice(session, params.installationId)

    reply.code(204)

    return null
  })

  app.post('/api/v1/push/test', async (request) => {
    const input = parseOrThrow(
      pushTestNotificationInputSchema,
      request.body,
      'invalid_body',
    )
    const session = await resolveRouteWriteContext(request, sessionService)
    const result = await service.sendTestNotification(session, input)

    return pushTestNotificationResponseSchema.parse(result)
  })
}
