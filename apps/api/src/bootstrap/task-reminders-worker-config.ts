import {
  createFirebasePushConfig,
  type FirebasePushConfig,
  validateProductionDatabaseTransport,
} from './config.js'

export interface TaskRemindersWorkerRuntimeConfig {
  connectionString: string
  firebasePush: FirebasePushConfig
  selfCareBatchSize: number
  selfCareIntervalMs: number
  sharedTaskNotificationsBatchSize: number
  sharedTaskNotificationsIntervalMs: number
  taskBatchSize: number
  taskIntervalMs: number
}

export function createTaskRemindersWorkerRuntimeConfig(
  env: NodeJS.ProcessEnv = process.env,
): TaskRemindersWorkerRuntimeConfig {
  const connectionString =
    env.TASK_REMINDERS_DATABASE_URL?.trim() || env.WORKER_DATABASE_URL?.trim()
  const firebasePush = createFirebasePushConfig(env)

  if (!connectionString) {
    throw new Error(
      'TASK_REMINDERS_DATABASE_URL or WORKER_DATABASE_URL is required for the reminders worker.',
    )
  }

  if (!firebasePush) {
    throw new Error('Task reminders worker requires Firebase push config.')
  }

  if (env.NODE_ENV === 'production') {
    validateProductionDatabaseTransport(connectionString)

    for (const name of [
      'AUTH_JWT_SECRET',
      'AUTH_SMTP_PASSWORD',
      'DATABASE_URL',
      'MIGRATE_DATABASE_URL',
      'USER_BACKUP_RESTORE_DATABASE_URL',
    ]) {
      if (env[name]?.trim()) {
        throw new Error(
          `${name} must not be exposed to the production reminders worker.`,
        )
      }
    }
  }

  const taskIntervalMs = readPositiveInteger(
    env.TASK_REMINDERS_INTERVAL_MS,
    60_000,
    'TASK_REMINDERS_INTERVAL_MS',
  )

  return {
    connectionString,
    firebasePush,
    selfCareBatchSize: readPositiveInteger(
      env.SELF_CARE_REMINDERS_BATCH_SIZE,
      25,
      'SELF_CARE_REMINDERS_BATCH_SIZE',
    ),
    selfCareIntervalMs: readPositiveInteger(
      env.SELF_CARE_REMINDERS_INTERVAL_MS,
      taskIntervalMs,
      'SELF_CARE_REMINDERS_INTERVAL_MS',
    ),
    sharedTaskNotificationsBatchSize: readPositiveInteger(
      env.SHARED_TASK_NOTIFICATIONS_BATCH_SIZE,
      50,
      'SHARED_TASK_NOTIFICATIONS_BATCH_SIZE',
    ),
    sharedTaskNotificationsIntervalMs: readPositiveInteger(
      env.SHARED_TASK_NOTIFICATIONS_INTERVAL_MS,
      5_000,
      'SHARED_TASK_NOTIFICATIONS_INTERVAL_MS',
    ),
    taskBatchSize: readPositiveInteger(
      env.TASK_REMINDERS_BATCH_SIZE,
      25,
      'TASK_REMINDERS_BATCH_SIZE',
    ),
    taskIntervalMs,
  }
}

function readPositiveInteger(
  rawValue: string | undefined,
  fallback: number,
  name: string,
): number {
  if (!rawValue) {
    return fallback
  }

  const value = Number(rawValue)

  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`Invalid ${name}: ${rawValue}`)
  }

  return value
}
