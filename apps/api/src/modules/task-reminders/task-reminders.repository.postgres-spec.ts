import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { after, before, test } from 'node:test'

import {
  addDateDays,
  getDateKeyInTimeZone,
  getTimeInTimeZone,
  getTodayDate,
} from '@planner/contracts'

import {
  createDatabaseConnection,
  type DatabaseConnection,
  destroyDatabaseConnection,
} from '../../infrastructure/db/client.js'
import { createDatabaseConfig } from '../../infrastructure/db/config.js'
import {
  cleanupRepositoryContractUsers,
  seedRepositoryContractWorkspace,
} from '../../testing/repository-contract-fixtures.js'
import { PostgresTaskReminderRepository } from './task-reminders.repository.postgres.js'

let connection: DatabaseConnection

void before(() => {
  connection = createDatabaseConnection(createDatabaseConfig())
})

void after(async () => {
  if (connection) {
    await destroyDatabaseConnection(connection)
  }
})

void test('task reminders distinguish expired and permanently failed delivery', async () => {
  const actorUserId = randomUUID()

  await cleanupRepositoryContractUsers(connection, [actorUserId])

  try {
    const workspace = await seedRepositoryContractWorkspace(connection, {
      displayName: 'Reminder Delivery Contract',
      email: `reminder-delivery-${actorUserId}@example.test`,
      kind: 'personal',
      role: 'owner',
      userId: actorUserId,
      workspaceName: 'Reminder Delivery Contract',
    })
    const expiredTaskId = randomUUID()
    const failedTaskId = randomUUID()
    const expiredReminderId = randomUUID()
    const failedReminderId = randomUUID()
    const yesterday = addDateDays(getTodayDate('UTC'), -1)
    const soon = new Date(Date.now() + 2 * 60_000)
    const soonDate = getDateKeyInTimeZone(soon, 'UTC')
    const soonTime = `${getTimeInTimeZone(soon, 'UTC')}:00`

    await connection.pool.query(
      `
        insert into app.tasks (
          id, workspace_id, title, description, created_by, updated_by
        )
        values
          ($1, $3, 'Expired reminder task', '', $4, $4),
          ($2, $3, 'Failed reminder task', '', $4, $4)
      `,
      [expiredTaskId, failedTaskId, workspace.workspaceId, actorUserId],
    )
    await connection.pool.query(
      `
        insert into app.task_reminders (
          id,
          workspace_id,
          task_id,
          user_id,
          planned_date,
          planned_start_time,
          remind_offset_minutes,
          time_zone
        )
        values
          ($1, $3, $4, $5, $6::date, '09:00:00'::time, 15, 'UTC'),
          ($2, $3, $7, $5, $8::date, $9::time, 15, 'UTC')
      `,
      [
        expiredReminderId,
        failedReminderId,
        workspace.workspaceId,
        expiredTaskId,
        actorUserId,
        yesterday,
        failedTaskId,
        soonDate,
        soonTime,
      ],
    )

    const repository = new PostgresTaskReminderRepository(connection.db)
    const claimed = await repository.claimDueReminders(10)

    assert.equal(
      claimed.some((reminder) => reminder.id === expiredReminderId),
      false,
    )

    for (let attempt = 1; attempt <= 8; attempt += 1) {
      await repository.releaseClaim(
        failedReminderId,
        `delivery attempt ${attempt} failed`,
      )
    }

    const result = await connection.pool.query<{
      attemptCount: number
      expiredAt: string | null
      failedAt: string | null
      id: string
      lastError: string | null
      sentAt: string | null
    }>(
      `
        select
          id,
          attempt_count as "attemptCount",
          expired_at as "expiredAt",
          failed_at as "failedAt",
          last_error as "lastError",
          sent_at as "sentAt"
        from app.task_reminders
        where id in ($1, $2)
        order by id
      `,
      [expiredReminderId, failedReminderId],
    )
    const byId = new Map(result.rows.map((row) => [row.id, row]))
    const expired = byId.get(expiredReminderId)
    const failed = byId.get(failedReminderId)

    assert.equal(expired?.sentAt, null)
    assert.ok(expired?.expiredAt)
    assert.equal(expired?.lastError, 'delivery_window_expired')
    assert.equal(failed?.sentAt, null)
    assert.equal(failed?.attemptCount, 8)
    assert.ok(failed?.failedAt)
    assert.equal(failed?.lastError, 'delivery attempt 8 failed')
  } finally {
    await cleanupRepositoryContractUsers(connection, [actorUserId])
  }
})
