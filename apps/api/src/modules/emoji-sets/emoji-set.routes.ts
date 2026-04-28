import {
  addEmojiSetItemsInputSchema,
  emojiSetListResponseSchema,
  emojiSetRecordSchema,
  newEmojiSetInputSchema,
} from '@planner/contracts'
import type { FastifyInstance, FastifyRequest } from 'fastify'
import { z } from 'zod'

import { getRequestAuth } from '../../bootstrap/request-auth.js'
import { parseOrThrow } from '../../bootstrap/validation.js'
import type { SessionService } from '../session/index.js'
import type { EmojiSetService } from './emoji-set.service.js'

const readHeadersSchema = z.object({
  'x-workspace-id': z.string().min(1),
})

const writeHeadersSchema = readHeadersSchema.extend({
  'x-actor-user-id': z.string().min(1),
})

const emojiSetParamsSchema = z.object({
  emojiSetId: z.string().min(1),
})

const emojiSetItemParamsSchema = emojiSetParamsSchema.extend({
  iconAssetId: z.string().min(1),
})

export function registerEmojiSetRoutes(
  app: FastifyInstance,
  sessionService: SessionService,
  service: EmojiSetService,
): void {
  app.get('/api/v1/emoji-sets', async (request) => {
    const headers = parseOrThrow(
      readHeadersSchema,
      request.headers,
      'invalid_headers',
    )
    const context = resolveReadContext(request, headers)
    const emojiSets = await service.listEmojiSets(context)

    return emojiSetListResponseSchema.parse(emojiSets)
  })

  app.get('/api/v1/emoji-sets/:emojiSetId', async (request) => {
    const headers = parseOrThrow(
      readHeadersSchema,
      request.headers,
      'invalid_headers',
    )
    const params = parseOrThrow(
      emojiSetParamsSchema,
      request.params,
      'invalid_params',
    )
    const context = resolveReadContext(request, headers)
    const emojiSet = await service.getEmojiSet(context, params.emojiSetId)

    return emojiSetRecordSchema.parse(emojiSet)
  })

  app.delete('/api/v1/emoji-sets/:emojiSetId', async (request, reply) => {
    const headers = parseHeadersForWrite(request)
    const params = parseOrThrow(
      emojiSetParamsSchema,
      request.params,
      'invalid_params',
    )
    const context = await resolveWriteContext(request, sessionService, headers)

    await service.deleteEmojiSet(context, params.emojiSetId)

    reply.code(204).send()
  })

  app.post('/api/v1/emoji-sets', async (request, reply) => {
    const headers = parseHeadersForWrite(request)
    const input = parseOrThrow(
      newEmojiSetInputSchema,
      request.body,
      'invalid_body',
    )
    const context = await resolveWriteContext(request, sessionService, headers)
    const emojiSet = await service.createEmojiSet(context, input)

    reply.code(201)

    return emojiSetRecordSchema.parse(emojiSet)
  })

  app.post('/api/v1/emoji-sets/:emojiSetId/items', async (request, reply) => {
    const headers = parseHeadersForWrite(request)
    const params = parseOrThrow(
      emojiSetParamsSchema,
      request.params,
      'invalid_params',
    )
    const input = parseOrThrow(
      addEmojiSetItemsInputSchema,
      request.body,
      'invalid_body',
    )
    const context = await resolveWriteContext(request, sessionService, headers)
    const emojiSet = await service.addEmojiSetItems(
      context,
      params.emojiSetId,
      input,
    )

    reply.code(201)

    return emojiSetRecordSchema.parse(emojiSet)
  })

  app.delete(
    '/api/v1/emoji-sets/:emojiSetId/items/:iconAssetId',
    async (request, reply) => {
      const headers = parseHeadersForWrite(request)
      const params = parseOrThrow(
        emojiSetItemParamsSchema,
        request.params,
        'invalid_params',
      )
      const context = await resolveWriteContext(
        request,
        sessionService,
        headers,
      )

      await service.deleteEmojiSetItem(
        context,
        params.emojiSetId,
        params.iconAssetId,
      )

      reply.code(204).send()
    },
  )
}

function createLegacyWriteContext(headers: z.infer<typeof writeHeadersSchema>) {
  return {
    appRole: undefined,
    actorUserId: headers['x-actor-user-id'],
    auth: null,
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

function resolveReadContext(
  request: FastifyRequest,
  headers: z.infer<typeof readHeadersSchema>,
) {
  const authContext = getRequestAuth(request)

  if (!authContext) {
    return {
      appRole: undefined,
      actorUserId: undefined,
      auth: null,
      workspaceId: headers['x-workspace-id'],
    }
  }

  return {
    appRole: undefined,
    actorUserId: authContext.claims.sub,
    auth: authContext,
    workspaceId: headers['x-workspace-id'],
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
    appRole: session.appRole,
    actorUserId: session.actorUserId,
    auth: authContext,
    workspaceId: session.workspaceId,
  }
}
