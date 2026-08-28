import assert from 'node:assert/strict'
import test from 'node:test'

import { createTaskRemindersWorkerRuntimeConfig } from './task-reminders-worker-config.js'
import { createUserBackupRestoreHelperRuntimeConfig } from './user-backup-restore-helper-config.js'

const FIREBASE_ENV = {
  FIREBASE_CLIENT_EMAIL: 'firebase@example.iam.gserviceaccount.com',
  FIREBASE_PRIVATE_KEY: 'private-key',
  FIREBASE_PROJECT_ID: 'planner-test',
}

void test('reminders worker accepts only its dedicated database and push config', () => {
  const config = createTaskRemindersWorkerRuntimeConfig({
    ...FIREBASE_ENV,
    NODE_ENV: 'production',
    TASK_REMINDERS_DATABASE_URL:
      'postgres://worker:secret@127.0.0.1:5432/planner',
  })

  assert.match(config.connectionString, /worker/)
  assert.equal(config.selfCareBatchSize, 25)
  assert.equal(config.sharedTaskNotificationsBatchSize, 50)
  assert.equal(config.sharedTaskNotificationsIntervalMs, 5_000)
  assert.equal(config.taskBatchSize, 25)
  assert.throws(
    () =>
      createTaskRemindersWorkerRuntimeConfig({
        ...FIREBASE_ENV,
        DATABASE_URL: 'postgres://runtime:secret@127.0.0.1:5432/planner',
        NODE_ENV: 'production',
        TASK_REMINDERS_DATABASE_URL:
          'postgres://worker:secret@127.0.0.1:5432/planner',
      }),
    /DATABASE_URL must not be exposed/,
  )
})

void test('reminders worker keeps task and self-care batch sizes independent', () => {
  const config = createTaskRemindersWorkerRuntimeConfig({
    ...FIREBASE_ENV,
    NODE_ENV: 'production',
    SELF_CARE_REMINDERS_BATCH_SIZE: '11',
    SHARED_TASK_NOTIFICATIONS_BATCH_SIZE: '31',
    SHARED_TASK_NOTIFICATIONS_INTERVAL_MS: '7000',
    TASK_REMINDERS_BATCH_SIZE: '17',
    TASK_REMINDERS_DATABASE_URL:
      'postgres://worker:secret@127.0.0.1:5432/planner',
  })

  assert.equal(config.selfCareBatchSize, 11)
  assert.equal(config.sharedTaskNotificationsBatchSize, 31)
  assert.equal(config.sharedTaskNotificationsIntervalMs, 7_000)
  assert.equal(config.taskBatchSize, 17)
})

void test('restore helper rejects unrelated production credentials', () => {
  const baseEnv = {
    API_ICON_ASSET_DIR: '/var/lib/planner/icon-assets',
    NODE_ENV: 'production',
    USER_BACKUP_RESTORE_DATABASE_URL:
      'postgres://restore:secret@127.0.0.1:5432/planner',
    USER_BACKUP_RESTORE_HELPER_SECRET:
      'planner-test-restore-helper-secret-32-chars',
  }

  assert.equal(
    createUserBackupRestoreHelperRuntimeConfig(baseEnv).host,
    '127.0.0.1',
  )
  assert.throws(
    () =>
      createUserBackupRestoreHelperRuntimeConfig({
        ...baseEnv,
        AUTH_JWT_SECRET: 'api-secret-must-not-leak',
      }),
    /AUTH_JWT_SECRET must not be exposed/,
  )
})
