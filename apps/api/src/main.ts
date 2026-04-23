import type { FastifyInstance } from 'fastify'

import { buildApiApp } from './bootstrap/build-app.js'
import { createApiConfig } from './bootstrap/config.js'
import { NoopRequestAuthenticator } from './bootstrap/request-auth.js'
import { SupabaseRequestAuthenticator } from './infrastructure/auth/supabase-request-authenticator.js'
import {
  createDatabaseConnection,
  type DatabaseConnection,
  destroyDatabaseConnection,
} from './infrastructure/db/client.js'
import { createDatabaseConfig } from './infrastructure/db/config.js'
import {
  ChaosInboxService,
  MemoryChaosInboxRepository,
  PostgresChaosInboxRepository,
} from './modules/chaos-inbox/index.js'
import {
  DailyPlanService,
  MemoryDailyPlanRepository,
  PostgresDailyPlanRepository,
} from './modules/daily-plans/index.js'
import {
  EmojiSetService,
  LocalIconAssetStorage,
  MemoryEmojiSetRepository,
  PostgresEmojiSetRepository,
} from './modules/emoji-sets/index.js'
import {
  LifeSphereService,
  MemoryLifeSphereRepository,
  PostgresLifeSphereRepository,
} from './modules/life-spheres/index.js'
import {
  MemoryProjectRepository,
  PostgresProjectRepository,
  ProjectService,
} from './modules/projects/index.js'
import {
  MemorySessionRepository,
  PostgresSessionRepository,
  SessionService,
} from './modules/session/index.js'
import {
  MemoryTaskTemplateRepository,
  PostgresTaskTemplateRepository,
  TaskTemplateService,
} from './modules/task-templates/index.js'
import {
  MemoryTaskRepository,
  PostgresTaskRepository,
  TaskService,
} from './modules/tasks/index.js'

export interface ApiKernel {
  app: FastifyInstance
  config: ReturnType<typeof createApiConfig>
  database: DatabaseConnection | null
}

export function createApiKernel(
  env: NodeJS.ProcessEnv = process.env,
): ApiKernel {
  const config = createApiConfig(env)
  const database =
    config.storageDriver === 'postgres'
      ? createDatabaseConnection(createDatabaseConfig(env))
      : null
  const taskRepository = database
    ? new PostgresTaskRepository(database.db)
    : new MemoryTaskRepository()
  const chaosInboxRepository = database
    ? new PostgresChaosInboxRepository(database.db)
    : new MemoryChaosInboxRepository()
  const dailyPlanRepository = database
    ? new PostgresDailyPlanRepository(database.db)
    : new MemoryDailyPlanRepository()
  const taskTemplateRepository = database
    ? new PostgresTaskTemplateRepository(database.db)
    : new MemoryTaskTemplateRepository()
  const projectRepository = database
    ? new PostgresProjectRepository(database.db)
    : new MemoryProjectRepository()
  const emojiSetRepository = database
    ? new PostgresEmojiSetRepository(database.db)
    : new MemoryEmojiSetRepository()
  const lifeSphereRepository = database
    ? new PostgresLifeSphereRepository(database.db)
    : new MemoryLifeSphereRepository()
  const sessionRepository = database
    ? new PostgresSessionRepository(database.db)
    : new MemorySessionRepository()
  const iconAssetStorage = new LocalIconAssetStorage(config.iconAssetDirectory)
  const sessionService = new SessionService(sessionRepository)
  const emojiSetService = new EmojiSetService(
    emojiSetRepository,
    iconAssetStorage,
  )
  const lifeSphereService = new LifeSphereService(lifeSphereRepository)
  const projectService = new ProjectService(projectRepository)
  const taskTemplateService = new TaskTemplateService(taskTemplateRepository)
  const taskService = new TaskService(taskRepository)
  const chaosInboxService = new ChaosInboxService(
    chaosInboxRepository,
    taskService,
  )
  const dailyPlanService = new DailyPlanService(dailyPlanRepository)
  const requestAuthenticator =
    config.authMode === 'supabase' && config.supabaseAuth
      ? new SupabaseRequestAuthenticator(config.supabaseAuth)
      : new NoopRequestAuthenticator()
  const app = buildApiApp({
    config,
    chaosInboxService,
    dailyPlanService,
    database,
    emojiSetService,
    lifeSphereService,
    projectService,
    requestAuthenticator,
    sessionService,
    taskTemplateService,
    taskService,
  })

  return {
    app,
    config,
    database,
  }
}

export async function destroyApiKernel(kernel: ApiKernel): Promise<void> {
  await kernel.app.close()

  if (kernel.database) {
    await destroyDatabaseConnection(kernel.database)
  }
}
