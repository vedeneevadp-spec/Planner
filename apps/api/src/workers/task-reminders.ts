import { createApiConfig } from '../bootstrap/config.js'
import {
  createDatabaseConnection,
  destroyDatabaseConnection,
} from '../infrastructure/db/client.js'
import { createDatabaseConfig } from '../infrastructure/db/config.js'
import {
  FirebasePushNotificationSender,
  NoopPushNotificationSender,
  PostgresPushNotificationsRepository,
  PushNotificationsService,
} from '../modules/push-notifications/index.js'
import {
  PostgresSelfCareReminderRepository,
  SelfCareRemindersPoller,
  SelfCareRemindersService,
} from '../modules/self-care-reminders/index.js'
import {
  PostgresTaskReminderRepository,
  TaskRemindersPoller,
  TaskRemindersService,
} from '../modules/task-reminders/index.js'

const config = createApiConfig(process.env)

if (config.storageDriver !== 'postgres') {
  throw new Error('Task reminders worker requires Postgres storage.')
}

const database = createDatabaseConnection(
  createDatabaseConfig({
    ...process.env,
    DATABASE_URL:
      process.env.TASK_REMINDERS_DATABASE_URL ??
      process.env.WORKER_DATABASE_URL ??
      process.env.DATABASE_URL,
  }),
)
const pushNotificationsService = new PushNotificationsService(
  new PostgresPushNotificationsRepository(database.db),
  config.firebasePush
    ? new FirebasePushNotificationSender(config.firebasePush)
    : new NoopPushNotificationSender(),
)

if (!pushNotificationsService.isAvailable()) {
  await destroyDatabaseConnection(database)
  throw new Error('Task reminders worker requires Firebase push config.')
}

const taskRemindersService = new TaskRemindersService(
  new PostgresTaskReminderRepository(database.db),
  pushNotificationsService,
)
const selfCareRemindersService = new SelfCareRemindersService(
  new PostgresSelfCareReminderRepository(database.db),
  pushNotificationsService,
)
const logger = {
  error: (payload: unknown, message: string) => {
    console.error(message, payload)
  },
  info: (payload: unknown, message: string) => {
    console.log(message, payload)
  },
}
const poller = new TaskRemindersPoller(taskRemindersService, logger, {
  batchSize: readPositiveInteger('TASK_REMINDERS_BATCH_SIZE', 25),
  intervalMs: readPositiveInteger('TASK_REMINDERS_INTERVAL_MS', 60_000),
  unrefTimer: false,
})
const selfCarePoller = new SelfCareRemindersPoller(
  selfCareRemindersService,
  logger,
  {
    batchSize: readPositiveInteger('SELF_CARE_REMINDERS_BATCH_SIZE', 25),
    intervalMs: readPositiveInteger(
      'SELF_CARE_REMINDERS_INTERVAL_MS',
      readPositiveInteger('TASK_REMINDERS_INTERVAL_MS', 60_000),
    ),
    unrefTimer: false,
  },
)

poller.start()
selfCarePoller.start()

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    void shutdown(signal)
  })
}

async function shutdown(signal: NodeJS.Signals): Promise<void> {
  console.log(`Stopping task reminders worker after ${signal}.`)
  await poller.stop()
  await selfCarePoller.stop()
  await destroyDatabaseConnection(database)
  process.exit(0)
}

function readPositiveInteger(name: string, fallback: number): number {
  const rawValue = process.env[name]

  if (!rawValue) {
    return fallback
  }

  const value = Number(rawValue)

  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`Invalid ${name}: ${rawValue}`)
  }

  return value
}
