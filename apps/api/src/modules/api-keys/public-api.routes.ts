import {
  type ApiKeyScope,
  chaosInboxItemRecordSchema,
  chaosInboxListRecordResponseSchema,
  createChaosInboxItemsInputSchema,
  getPlannerTimeZone,
  newTaskInputSchema,
  publicShoppingCreateSchema,
  publicShoppingListSchema,
  publicShoppingUpdateSchema,
  publicTaskCreateSchema,
  publicTaskListSchema,
  publicTaskStatusSchema,
  publicTaskUpdateSchema,
  taskDetailsUpdateInputSchema,
  taskListPageResponseSchema,
  taskRecordSchema,
} from '@planner/contracts'
import type { FastifyInstance, FastifyRequest } from 'fastify'
import fastifyRateLimit from 'fastify-rate-limit'
import { z } from 'zod'

import { HttpError } from '../../bootstrap/http-error.js'
import {
  getClientAddress,
  type RateLimiter,
} from '../../bootstrap/rate-limit.js'
import { parseOrThrow } from '../../bootstrap/validation.js'
import type { ChaosInboxService } from '../chaos-inbox/index.js'
import type { SessionService } from '../session/index.js'
import type { TaskService } from '../tasks/index.js'
import type { ApiKeyService } from './api-key.service.js'

const base = '/api/public/v1'
const paramsSchema = z.object({ id: z.string().uuid() })

export function registerPublicApiRoutes(
  app: FastifyInstance,
  options: {
    keys: ApiKeyService
    sessions: SessionService
    tasks: TaskService
    shopping: ChaosInboxService
    rateLimiter: RateLimiter
  },
) {
  app.register(async (instance) => {
    instance.register(fastifyRateLimit, {
      errorResponseBuilder: (_request, context) =>
        new HttpError(
          429,
          'rate_limit_exceeded',
          'Too many requests. Please try again later.',
          {
            retryAfterSeconds: Math.max(1, Math.ceil(context.ttl / 1000)),
          },
        ),
      keyGenerator: getClientAddress,
      max: 300,
      timeWindow: 60_000,
    })
    await instance.after()
    instance.addHook('onRequest', async (request, reply) => {
      reply.header('Cache-Control', 'no-store')
      await options.rateLimiter.consume({
        key: `public-api:ip:${getClientAddress(request)}`,
        limit: 300,
        windowMs: 60_000,
      })
    })
    async function context(request: FastifyRequest, scope: ApiKeyScope) {
      const { key, auth } = await options.keys.authenticate(
        request.headers.authorization,
        scope,
      )
      await options.rateLimiter.consume({
        key: `public-api:key:${key.id}`,
        limit: 120,
        windowMs: 60_000,
      })
      await options.rateLimiter.consume({
        key: `public-api:user:${key.userId}`,
        limit: 240,
        windowMs: 60_000,
      })
      if (
        request.headers['x-workspace-id'] &&
        request.headers['x-workspace-id'] !== key.workspaceId
      ) {
        throw new HttpError(
          403,
          'api_key_workspace_mismatch',
          'Ключ привязан к другому пространству.',
        )
      }
      const session = await options.sessions.resolveSession({
        auth,
        actorUserId: undefined,
        workspaceId: key.workspaceId,
      })
      if (
        session.actorUserId !== key.userId ||
        session.workspaceId !== key.workspaceId
      ) {
        throw new HttpError(
          403,
          'api_key_workspace_mismatch',
          'Нет доступа к пространству ключа.',
        )
      }
      request.log.info(
        { apiKeyId: key.id, operation: request.routeOptions.url, scope },
        'API key request authorized',
      )
      return {
        auth,
        actorUserId: session.actorUserId,
        actorDisplayName: session.actor.displayName,
        clientTimeZone: getPlannerTimeZone({
          deviceTimeZone: session.userPreferences.lastSeenTimeZone,
          timeZoneMode: session.userPreferences.timeZoneMode,
          userTimeZone: session.userPreferences.defaultTimeZone,
          workspaceTimeZone: session.workspaceSettings.defaultTimeZone,
        }),
        workspaceId: key.workspaceId,
        workspaceKind: session.workspace.kind,
        role: session.role,
        groupRole: session.groupRole,
      }
    }
    instance.get(`${base}/tasks`, async (request) => {
      const ctx = await context(request, 'tasks:read')
      const filters = parseOrThrow(
        publicTaskListSchema,
        request.query,
        'invalid_query',
      )
      return taskListPageResponseSchema.parse(
        await options.tasks.listTaskPage(ctx, filters),
      )
    })
    instance.get(`${base}/tasks/:id`, async (request) => {
      const ctx = await context(request, 'tasks:read')
      const { id } = parseOrThrow(
        paramsSchema,
        request.params,
        'invalid_params',
      )
      return taskRecordSchema.parse(await options.tasks.getTask(ctx, id))
    })
    instance.post(`${base}/tasks`, async (request, reply) => {
      const ctx = await context(request, 'tasks:write')
      const input = parseOrThrow(
        publicTaskCreateSchema,
        request.body,
        'invalid_body',
      )
      const task = await options.tasks.createTask(
        ctx,
        newTaskInputSchema.parse(input),
      )
      reply.code(201)
      return taskRecordSchema.parse(task)
    })
    instance.patch(`${base}/tasks/:id`, async (request) => {
      const ctx = await context(request, 'tasks:write')
      const { id } = parseOrThrow(
        paramsSchema,
        request.params,
        'invalid_params',
      )
      const patch = parseOrThrow(
        publicTaskUpdateSchema,
        request.body,
        'invalid_body',
      )
      const current = await options.tasks.getTask(ctx, id)
      const input = taskDetailsUpdateInputSchema.parse({
        ...current,
        ...patch,
        ...(patch.plannedDate === null
          ? {
              plannedStartTime: null,
              plannedEndTime: null,
              remindBeforeStart: false,
              reminderOffsets: [],
            }
          : {}),
      })
      return taskRecordSchema.parse(
        await options.tasks.updateTask(
          {
            ...ctx,
            clientTimeZone:
              current.schedule?.kind === 'fixed_zone_datetime'
                ? current.schedule.timeZone
                : ctx.clientTimeZone,
          },
          id,
          input,
        ),
      )
    })
    instance.patch(`${base}/tasks/:id/status`, async (request) => {
      const ctx = await context(request, 'tasks:write')
      const { id } = parseOrThrow(
        paramsSchema,
        request.params,
        'invalid_params',
      )
      const input = parseOrThrow(
        publicTaskStatusSchema,
        request.body,
        'invalid_body',
      )
      return taskRecordSchema.parse(
        await options.tasks.setTaskStatus(
          ctx,
          id,
          input.status,
          input.expectedVersion,
        ),
      )
    })
    instance.get(`${base}/shopping`, async (request) => {
      const ctx = await context(request, 'shopping:read')
      const filters = parseOrThrow(
        publicShoppingListSchema,
        request.query,
        'invalid_query',
      )
      return chaosInboxListRecordResponseSchema.parse(
        await options.shopping.listItems(ctx, { ...filters, kind: 'shopping' }),
      )
    })
    instance.get(`${base}/shopping/:id`, async (request) => {
      const ctx = await context(request, 'shopping:read')
      const { id } = parseOrThrow(
        paramsSchema,
        request.params,
        'invalid_params',
      )
      return chaosInboxItemRecordSchema.parse(
        await options.shopping.getShoppingItem(ctx, id),
      )
    })
    instance.post(`${base}/shopping`, async (request, reply) => {
      const ctx = await context(request, 'shopping:write')
      const input = parseOrThrow(
        publicShoppingCreateSchema,
        request.body,
        'invalid_body',
      )
      const items = await options.shopping.createItems(
        ctx,
        createChaosInboxItemsInputSchema.parse({
          items: [{ ...input, kind: 'shopping' }],
        }),
      )
      reply.code(201)
      return chaosInboxItemRecordSchema.parse(items[0])
    })
    instance.patch(`${base}/shopping/:id`, async (request) => {
      const ctx = await context(request, 'shopping:write')
      const { id } = parseOrThrow(
        paramsSchema,
        request.params,
        'invalid_params',
      )
      const input = parseOrThrow(
        publicShoppingUpdateSchema,
        request.body,
        'invalid_body',
      )
      return chaosInboxItemRecordSchema.parse(
        await options.shopping.updateShoppingItem(ctx, id, input),
      )
    })
  })
}
