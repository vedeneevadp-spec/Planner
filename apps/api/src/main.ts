import path from 'node:path'

import type { FastifyInstance } from 'fastify'

import { buildApiApp } from './bootstrap/build-app.js'
import { createApiConfig } from './bootstrap/config.js'
import { NoopRequestAuthenticator } from './bootstrap/request-auth.js'
import { JwtRequestAuthenticator } from './infrastructure/auth/jwt-request-authenticator.js'
import {
  createDatabaseConnection,
  type DatabaseConnection,
  destroyDatabaseConnection,
} from './infrastructure/db/client.js'
import { createDatabaseConfig } from './infrastructure/db/config.js'
import {
  AuthService,
  NoopAuthEmailSender,
  PostgresAuthRepository,
  SmtpAuthEmailSender,
} from './modules/auth/index.js'
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
  HabitService,
  MemoryHabitRepository,
  PostgresHabitRepository,
} from './modules/habits/index.js'
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
  FirebasePushNotificationSender,
  MemoryPushNotificationsRepository,
  NoopPushNotificationSender,
  PostgresPushNotificationsRepository,
  PushNotificationsService,
} from './modules/push-notifications/index.js'
import {
  LocalProfileAvatarStorage,
  MemorySessionRepository,
  PostgresSessionRepository,
  SessionService,
} from './modules/session/index.js'
import {
  PostgresTaskReminderRepository,
  TaskRemindersPoller,
  TaskRemindersService,
} from './modules/task-reminders/index.js'
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
  stopBackgroundJobs: () => Promise<void>
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
  const habitRepository = database
    ? new PostgresHabitRepository(database.db)
    : new MemoryHabitRepository()
  const pushNotificationsRepository = database
    ? new PostgresPushNotificationsRepository(database.db)
    : new MemoryPushNotificationsRepository()
  const sessionRepository = database
    ? new PostgresSessionRepository(database.db)
    : new MemorySessionRepository()
  const authService =
    database && config.plannerAuth
      ? new AuthService(
          new PostgresAuthRepository(database.db),
          config.plannerAuth.smtp
            ? new SmtpAuthEmailSender(config.plannerAuth)
            : new NoopAuthEmailSender(config.appEnv),
          config.plannerAuth,
        )
      : undefined
  const iconAssetStorage = new LocalIconAssetStorage(config.iconAssetDirectory)
  const profileAvatarStorage = new LocalProfileAvatarStorage(
    path.join(config.iconAssetDirectory, 'profiles'),
  )
  const sessionService = new SessionService(
    sessionRepository,
    profileAvatarStorage,
  )
  const emojiSetService = new EmojiSetService(
    emojiSetRepository,
    iconAssetStorage,
  )
  const lifeSphereService = new LifeSphereService(lifeSphereRepository)
  const habitService = new HabitService(habitRepository)
  const pushNotificationsService = new PushNotificationsService(
    pushNotificationsRepository,
    config.firebasePush
      ? new FirebasePushNotificationSender(config.firebasePush)
      : new NoopPushNotificationSender(),
  )
  const projectService = new ProjectService(projectRepository)
  const taskTemplateService = new TaskTemplateService(taskTemplateRepository)
  const taskService = new TaskService(taskRepository)
  const chaosInboxService = new ChaosInboxService(
    chaosInboxRepository,
    taskService,
  )
  const dailyPlanService = new DailyPlanService(dailyPlanRepository)
  const backgroundJobs: Array<{ stop: () => Promise<void> }> = []
  const requestAuthenticator =
    config.authMode === 'jwt' && config.jwtAuth
      ? new JwtRequestAuthenticator(config.jwtAuth)
      : new NoopRequestAuthenticator()
  const app = buildApiApp({
    config,
    ...(authService ? { authService } : {}),
    chaosInboxService,
    dailyPlanService,
    database,
    emojiSetService,
    habitService,
    lifeSphereService,
    pushNotificationsService,
    projectService,
    requestAuthenticator,
    sessionService,
    taskTemplateService,
    taskService,
  })

  if (
    database &&
    config.appEnv !== 'test' &&
    config.taskRemindersRuntime === 'api' &&
    pushNotificationsService.isAvailable()
  ) {
    const taskRemindersService = new TaskRemindersService(
      new PostgresTaskReminderRepository(database.db),
      pushNotificationsService,
    )
    const taskRemindersPoller = new TaskRemindersPoller(
      taskRemindersService,
      app.log,
    )

    taskRemindersPoller.start()
    backgroundJobs.push(taskRemindersPoller)
  }

  return {
    app,
    config,
    database,
    stopBackgroundJobs: async () => {
      for (const job of backgroundJobs) {
        await job.stop()
      }
    },
  }
}

export async function destroyApiKernel(kernel: ApiKernel): Promise<void> {
  await kernel.stopBackgroundJobs()
  await kernel.app.close()

  if (kernel.database) {
    await destroyDatabaseConnection(kernel.database)
  }
}
