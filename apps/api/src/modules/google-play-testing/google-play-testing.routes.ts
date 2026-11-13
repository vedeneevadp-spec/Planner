import {
  googlePlayTestingAdminSchema,
  googlePlayTestingInputSchema,
  googlePlayTestingReviewSchema,
  googlePlayTestingSettingsSchema,
  googlePlayTestingStateSchema,
} from '@planner/contracts'
import type { FastifyInstance, FastifyRequest } from 'fastify'
import { z } from 'zod'

import { HttpError } from '../../bootstrap/http-error.js'
import { requireRequestAuth } from '../../bootstrap/request-auth.js'
import { parseOrThrow } from '../../bootstrap/validation.js'
import type { SessionService } from '../session/index.js'
import type {
  GooglePlayTestingRepository,
  TestingActor,
} from './google-play-testing.repository.js'

const invitation = {
  joinUrl: 'https://play.google.com/apps/testing/ru.chaotika.app',
  downloadUrl: 'https://play.google.com/store/apps/details?id=ru.chaotika.app',
}

export function registerGooglePlayTestingRoutes(
  app: FastifyInstance,
  repository: GooglePlayTestingRepository,
  sessions: SessionService,
) {
  async function actor(
    request: FastifyRequest,
    admin = false,
  ): Promise<TestingActor> {
    const auth = requireRequestAuth(request)
    const session = await sessions.resolveSession({
      auth,
      actorUserId: undefined,
      workspaceId: undefined,
    })
    if (admin && session.appRole !== 'owner' && session.appRole !== 'admin') {
      throw new HttpError(
        403,
        'admin_required',
        'Этот раздел доступен только администратору.',
      )
    }
    return { auth, userId: session.actorUserId }
  }
  async function state(owner: TestingActor) {
    const [isOpen, requests] = await Promise.all([
      repository.isOpen(owner),
      repository.list(owner),
    ])
    const request =
      requests.find((entry) => entry.userId === owner.userId) ?? null
    return googlePlayTestingStateSchema.parse({
      isOpen,
      request,
      invitation: request?.status === 'invited' ? invitation : null,
    })
  }
  app.get('/api/v1/google-play-testing', async (request, reply) => {
    reply.header('Cache-Control', 'no-store')
    return state(await actor(request))
  })
  app.put('/api/v1/google-play-testing/request', async (request, reply) => {
    reply.header('Cache-Control', 'no-store')
    const owner = await actor(request)
    const input = parseOrThrow(
      googlePlayTestingInputSchema,
      request.body,
      'invalid_body',
    )
    await repository.submit(owner, input.googleEmail)
    return state(owner)
  })
  app.get('/api/v1/admin/google-play-testing', async (request, reply) => {
    reply.header('Cache-Control', 'no-store')
    const owner = await actor(request, true)
    const [isOpen, requests] = await Promise.all([
      repository.isOpen(owner),
      repository.list(owner),
    ])
    return googlePlayTestingAdminSchema.parse({ isOpen, requests })
  })
  app.patch('/api/v1/admin/google-play-testing', async (request, reply) => {
    reply.header('Cache-Control', 'no-store')
    const owner = await actor(request, true)
    const { isOpen } = parseOrThrow(
      googlePlayTestingSettingsSchema,
      request.body,
      'invalid_body',
    )
    await repository.setOpen(owner, isOpen)
    return { isOpen }
  })
  app.patch(
    '/api/v1/admin/google-play-testing/requests/:userId',
    async (request, reply) => {
      reply.header('Cache-Control', 'no-store')
      const owner = await actor(request, true)
      const { userId } = parseOrThrow(
        z.object({ userId: z.string().uuid() }),
        request.params,
        'invalid_params',
      )
      const input = parseOrThrow(
        googlePlayTestingReviewSchema,
        request.body,
        'invalid_body',
      )
      return repository.review(owner, userId, input)
    },
  )
}
