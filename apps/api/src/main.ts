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
  MemorySessionRepository,
  PostgresSessionRepository,
  SessionService,
} from './modules/session/index.js'
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
  const sessionRepository = database
    ? new PostgresSessionRepository(database.db)
    : new MemorySessionRepository()
  const sessionService = new SessionService(sessionRepository)
  const taskService = new TaskService(taskRepository)
  const requestAuthenticator =
    config.authMode === 'supabase' && config.supabaseAuth
      ? new SupabaseRequestAuthenticator(config.supabaseAuth)
      : new NoopRequestAuthenticator()
  const app = buildApiApp({
    config,
    database,
    requestAuthenticator,
    sessionService,
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
