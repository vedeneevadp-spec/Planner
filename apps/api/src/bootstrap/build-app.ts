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
import type { ChaosInboxService } from '../modules/chaos-inbox/index.js'
import { registerChaosInboxRoutes } from '../modules/chaos-inbox/index.js'
import type { DailyPlanService } from '../modules/daily-plans/index.js'
import { registerDailyPlanRoutes } from '../modules/daily-plans/index.js'
import type { EmojiSetService } from '../modules/emoji-sets/index.js'
import {
  registerEmojiSetRoutes,
  registerIconAssetRoutes,
} from '../modules/emoji-sets/index.js'
import type { LifeSphereService } from '../modules/life-spheres/index.js'
import { registerLifeSphereRoutes } from '../modules/life-spheres/index.js'
import type { ProjectService } from '../modules/projects/index.js'
import { registerProjectRoutes } from '../modules/projects/index.js'
import type { SessionService } from '../modules/session/index.js'
import { registerSessionRoutes } from '../modules/session/index.js'
import type { TaskTemplateService } from '../modules/task-templates/index.js'
import { registerTaskTemplateRoutes } from '../modules/task-templates/index.js'
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
  chaosInboxService?: ChaosInboxService
  dailyPlanService?: DailyPlanService
  emojiSetService?: EmojiSetService
  lifeSphereService?: LifeSphereService
  projectService: ProjectService
  sessionService: SessionService
  taskTemplateService?: TaskTemplateService
  taskService: TaskService
}

export function buildApiApp({
  config,
  database,
  requestAuthenticator = new NoopRequestAuthenticator(),
  chaosInboxService,
  dailyPlanService,
  emojiSetService,
  lifeSphereService,
  projectService,
  sessionService,
  taskTemplateService,
  taskService,
}: BuildApiAppOptions) {
  const app = Fastify({
    bodyLimit: 25 * 1024 * 1024,
    logger: config.appEnv !== 'test',
    routerOptions: {
      maxParamLength: 260,
    },
  })

  app.register(cors, {
    methods: ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    origin: resolveCorsOrigin(config.corsOrigin),
  })
  registerOpenApi(app, config)
  registerIconAssetRoutes(app, config.iconAssetDirectory)

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
    if (emojiSetService) {
      registerEmojiSetRoutes(instance, sessionService, emojiSetService)
    }
    if (lifeSphereService) {
      registerLifeSphereRoutes(instance, sessionService, lifeSphereService)
    }
    registerProjectRoutes(instance, sessionService, projectService)
    if (taskTemplateService) {
      registerTaskTemplateRoutes(instance, sessionService, taskTemplateService)
    }
    registerTaskRoutes(instance, sessionService, taskService)
    if (dailyPlanService) {
      registerDailyPlanRoutes(instance, sessionService, dailyPlanService)
    }
    if (chaosInboxService) {
      registerChaosInboxRoutes(instance, sessionService, chaosInboxService)
    }
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

const NATIVE_APP_CORS_ORIGINS = [
  'capacitor://localhost',
  'http://localhost',
  'https://localhost',
  'ionic://localhost',
] as const

function resolveCorsOrigin(corsOrigin: string): true | string | string[] {
  if (corsOrigin === '*') {
    return true
  }

  const configuredOrigins = corsOrigin
    .split(',')
    .map((origin) => origin.trim())
    .filter((origin) => origin.length > 0)
  const allowedOrigins = Array.from(
    new Set([...configuredOrigins, ...NATIVE_APP_CORS_ORIGINS]),
  )

  return allowedOrigins.length === 1 ? allowedOrigins[0]! : allowedOrigins
}

function isPublicRequest(method: string, url: string): boolean {
  if (method === 'OPTIONS') {
    return true
  }

  const [path = url] = url.split('?')

  return (
    path === '/api/health' ||
    path.startsWith('/api/v1/icon-assets/') ||
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
