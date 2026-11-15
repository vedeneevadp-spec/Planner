import {
  emailVerificationConfirmInputSchema,
  emailVerificationStatusSchema,
} from '@planner/contracts'
import type { FastifyInstance } from 'fastify'

import { getClientAddress } from '../../bootstrap/rate-limit.js'
import { requireRequestAuth } from '../../bootstrap/request-auth.js'
import { parseOrThrow } from '../../bootstrap/validation.js'
import type { EmailVerificationService } from './email-verification.service.js'

export function registerEmailVerificationRoutes(
  app: FastifyInstance,
  service: EmailVerificationService,
): void {
  app.get('/api/v1/email-verification', async (request, reply) => {
    reply.header('cache-control', 'no-store')
    return emailVerificationStatusSchema.parse(
      await service.getStatus(requireRequestAuth(request).claims.sub),
    )
  })
  app.post('/api/v1/email-verification/request', async (request, reply) => {
    await service.request(
      requireRequestAuth(request).claims.sub,
      getClientAddress(request),
    )
    return reply.code(204).send()
  })
  app.post('/api/v1/email-verification/confirm', async (request, reply) => {
    reply.header('cache-control', 'no-store')
    const userId = requireRequestAuth(request).claims.sub
    const input = parseOrThrow(
      emailVerificationConfirmInputSchema,
      request.body ?? {},
      'invalid_body',
    )
    return emailVerificationStatusSchema.parse(
      await service.confirm(userId, input.code, getClientAddress(request)),
    )
  })
}
