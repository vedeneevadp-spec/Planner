import {
  addEmojiSetItemsInputSchema,
  emojiSetListResponseSchema,
  emojiSetRecordSchema,
  newEmojiSetInputSchema,
} from '@planner/contracts'
import type { FastifyInstance } from 'fastify'
import { z } from 'zod'

import {
  resolveRouteTokenReadContext,
  resolveRouteWriteContext,
} from '../../bootstrap/route-context.js'
import { parseOrThrow } from '../../bootstrap/validation.js'
import type { SessionService } from '../session/index.js'
import type { EmojiSetService } from './emoji-set.service.js'

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
    const context = resolveRouteTokenReadContext(request)
    const emojiSets = await service.listEmojiSets(context)

    return emojiSetListResponseSchema.parse(emojiSets)
  })

  app.get('/api/v1/emoji-sets/:emojiSetId', async (request) => {
    const params = parseOrThrow(
      emojiSetParamsSchema,
      request.params,
      'invalid_params',
    )
    const context = resolveRouteTokenReadContext(request)
    const emojiSet = await service.getEmojiSet(context, params.emojiSetId)

    return emojiSetRecordSchema.parse(emojiSet)
  })

  app.delete('/api/v1/emoji-sets/:emojiSetId', async (request, reply) => {
    const params = parseOrThrow(
      emojiSetParamsSchema,
      request.params,
      'invalid_params',
    )
    const context = await resolveRouteWriteContext(request, sessionService)

    await service.deleteEmojiSet(context, params.emojiSetId)

    reply.code(204).send()
  })

  app.post('/api/v1/emoji-sets', async (request, reply) => {
    const input = parseOrThrow(
      newEmojiSetInputSchema,
      request.body,
      'invalid_body',
    )
    const context = await resolveRouteWriteContext(request, sessionService)
    const emojiSet = await service.createEmojiSet(context, input)

    reply.code(201)

    return emojiSetRecordSchema.parse(emojiSet)
  })

  app.post('/api/v1/emoji-sets/:emojiSetId/items', async (request, reply) => {
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
    const context = await resolveRouteWriteContext(request, sessionService)
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
      const params = parseOrThrow(
        emojiSetItemParamsSchema,
        request.params,
        'invalid_params',
      )
      const context = await resolveRouteWriteContext(request, sessionService)

      await service.deleteEmojiSetItem(
        context,
        params.emojiSetId,
        params.iconAssetId,
      )

      reply.code(204).send()
    },
  )
}
