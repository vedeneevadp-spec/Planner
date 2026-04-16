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

export interface BuildApiAppOptions {
  config: ApiConfig
  database: DatabaseConnection | null
  sessionService: SessionService
  taskService: TaskService
}

export function buildApiApp({
  config,
  database,
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

  app.register((instance) => {
    registerSessionRoutes(instance, sessionService)
    registerTaskRoutes(instance, taskService)
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
