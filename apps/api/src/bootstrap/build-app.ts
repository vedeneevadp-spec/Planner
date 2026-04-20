import cors from '@fastify/cors'
import type {
  ApiError,
  HealthDatabaseStatus,
  HealthResponse,
} from '@planner/contracts'
import { healthResponseSchema } from '@planner/contracts'
import Fastify from 'fastify'

import type { DatabaseConnection } from '../infrastructure/db/client.js'
import { pingDatabase } from '../infrastructure/db/client.js'
import type { SessionService } from '../modules/session/index.js'
import { registerSessionRoutes } from '../modules/session/index.js'
import type { TaskService } from '../modules/tasks/index.js'
import { registerTaskRoutes } from '../modules/tasks/index.js'
import type { ApiConfig } from './config.js'
import { HttpError } from './http-error.js'
import { registerOpenApi } from './openapi.js'
import {
  NoopRequestAuthenticator,
  type RequestAuthenticator,
} from './request-auth.js'

export interface BuildApiAppOptions {
  config: ApiConfig
  database: DatabaseConnection | null
  requestAuthenticator?: RequestAuthenticator
  sessionService: SessionService
  taskService: TaskService
}

export function buildApiApp({
  config,
  database,
  requestAuthenticator = new NoopRequestAuthenticator(),
  sessionService,
  taskService,
}: BuildApiAppOptions) {
  const app = Fastify({
    logger: config.appEnv !== 'test',
  })

  app.register(cors, {
    methods: ['GET', 'HEAD', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
    origin: config.corsOrigin === '*' ? true : config.corsOrigin,
  })
  registerOpenApi(app, config)

  app.get('/api/health', async (): Promise<HealthResponse> => {
    const databaseStatus = await getDatabaseStatus(database)

    return healthResponseSchema.parse({
      appEnv: config.appEnv,
      databaseStatus,
      status: 'ok',
      storageDriver: config.storageDriver,
      timestamp: new Date().toISOString(),
    })
  })

  app.decorateRequest('authContext', null)

  app.addHook('onRequest', async (request) => {
    if (isPublicRequest(request.method, request.url)) {
      return
    }

    request.authContext = await requestAuthenticator.authenticate(request)
  })

  app.register((instance) => {
    registerSessionRoutes(instance, sessionService)
    registerTaskRoutes(instance, sessionService, taskService)
  })

  app.setErrorHandler((error, request, reply) => {
    if (!(error instanceof HttpError)) {
      request.log.error({ err: error }, 'Unhandled request error.')
    }

    const httpError =
      error instanceof HttpError
        ? error
        : new HttpError(500, 'internal_error', 'Internal server error.')

    const payload: ApiError = {
      error: {
        code: httpError.code,
        details: httpError.details,
        message: httpError.message,
      },
    }

    reply.status(httpError.statusCode).send(payload)
  })

  return app
}

function isPublicRequest(method: string, url: string): boolean {
  if (method === 'OPTIONS') {
    return true
  }

  const [path = url] = url.split('?')

  return (
    path === '/api/health' ||
    path === '/api/openapi.json' ||
    path === '/api/docs' ||
    path.startsWith('/api/docs/')
  )
}

async function getDatabaseStatus(
  database: DatabaseConnection | null,
): Promise<HealthDatabaseStatus> {
  if (!database) {
    return 'disabled'
  }

  try {
    await pingDatabase(database)

    return 'up'
  } catch {
    return 'down'
  }
}
