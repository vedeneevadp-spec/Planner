import { createTaskRemindersWorkerRuntimeConfig } from '../bootstrap/task-reminders-worker-config.js'
import {
  createDatabaseConnection,
  destroyDatabaseConnection,
} from '../infrastructure/db/client.js'
import {
  FirebasePushNotificationSender,
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

const config = createTaskRemindersWorkerRuntimeConfig(process.env)

const database = createDatabaseConnection({
  connectionString: config.connectionString,
})
const pushNotificationsService = new PushNotificationsService(
  new PostgresPushNotificationsRepository(database.db),
  new FirebasePushNotificationSender(config.firebasePush),
)

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
  batchSize: config.taskBatchSize,
  intervalMs: config.taskIntervalMs,
  unrefTimer: false,
})
const selfCarePoller = new SelfCareRemindersPoller(
  selfCareRemindersService,
  logger,
  {
    batchSize: config.selfCareBatchSize,
    intervalMs: config.selfCareIntervalMs,
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
