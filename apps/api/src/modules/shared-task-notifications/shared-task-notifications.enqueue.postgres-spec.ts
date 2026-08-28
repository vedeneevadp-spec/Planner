import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { after, before, test } from 'node:test'

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
import { PostgresTaskRepository } from '../tasks/task.repository.postgres.js'
import { TaskService } from '../tasks/task.service.js'

interface NotificationRow {
  kind:
    | 'shared_task_assigned'
    | 'shared_task_created'
    | 'shared_task_ready_for_review'
  recipient_user_id: string
  task_id: string
}

const authorUserId = randomUUID()
const assigneeUserId = randomUUID()
const memberUserId = randomUUID()
const trackedUserIds = [authorUserId, assigneeUserId, memberUserId]
let connection: DatabaseConnection
let workspaceId: string

void before(async () => {
  connection = createDatabaseConnection(createDatabaseConfig())
  await cleanupRepositoryContractUsers(connection, trackedUserIds)

  const workspace = await seedRepositoryContractWorkspace(connection, {
    displayName: 'Notification author',
    email: `notification-author-${authorUserId}@example.test`,
    kind: 'shared',
    role: 'owner',
    userId: authorUserId,
    workspaceName: 'Notification workspace',
  })
  workspaceId = workspace.workspaceId

  await seedMember(assigneeUserId, 'Notification assignee')
  await seedMember(memberUserId, 'Notification member')
})

void after(async () => {
  if (connection) {
    await cleanupRepositoryContractUsers(connection, trackedUserIds)
    await destroyDatabaseConnection(connection)
  }
})

void test('enqueues one prioritized notification per recipient and only one review transition', async () => {
  const service = new TaskService(new PostgresTaskRepository(connection.db))
  const authorContext = {
    actorDisplayName: 'Notification author',
    actorUserId: authorUserId,
    auth: null,
    groupRole: null,
    role: 'owner' as const,
    workspaceId,
    workspaceKind: 'shared' as const,
    workspaceName: 'Notification workspace',
  }
  const taskInput: Parameters<TaskService['createTask']>[1] = {
    assigneeUserId,
    dueDate: null,
    icon: '',
    importance: 'not_important',
    note: '',
    plannedDate: null,
    plannedEndTime: null,
    plannedStartTime: null,
    project: '',
    projectId: null,
    recurrence: null,
    remindBeforeStart: false,
    reminderOffsets: [],
    resource: null,
    requiresConfirmation: false,
    routine: null,
    sphereId: null,
    title: 'Проверить уведомления',
    urgency: 'not_urgent',
  }
  const task = await service.createTask(authorContext, taskInput)

  assert.deepEqual(await listNotifications(task.id), [
    {
      kind: 'shared_task_assigned',
      recipient_user_id: assigneeUserId,
      task_id: task.id,
    },
    {
      kind: 'shared_task_created',
      recipient_user_id: memberUserId,
      task_id: task.id,
    },
  ])

  const assigneeContext = {
    ...authorContext,
    actorDisplayName: 'Notification assignee',
    actorUserId: assigneeUserId,
    groupRole: 'member' as const,
    role: 'user' as const,
  }
  const readyTask = await service.setTaskStatus(
    assigneeContext,
    task.id,
    'ready_for_review',
    task.version,
  )
  await service.setTaskStatus(
    assigneeContext,
    task.id,
    'ready_for_review',
    readyTask.version,
  )

  assert.deepEqual(await listNotifications(task.id), [
    {
      kind: 'shared_task_assigned',
      recipient_user_id: assigneeUserId,
      task_id: task.id,
    },
    {
      kind: 'shared_task_created',
      recipient_user_id: memberUserId,
      task_id: task.id,
    },
    {
      kind: 'shared_task_ready_for_review',
      recipient_user_id: authorUserId,
      task_id: task.id,
    },
  ])

  await connection.pool.query(
    `
      update app.users
      set shared_task_assigned_notifications_enabled = false
      where id = $1
    `,
    [assigneeUserId],
  )
  await connection.pool.query(
    `
      update app.users
      set shared_task_created_notifications_enabled = false
      where id = $1
    `,
    [memberUserId],
  )

  const fallbackTask = await service.createTask(authorContext, {
    ...taskInput,
    title: 'Проверить fallback уведомления',
  })

  assert.deepEqual(await listNotifications(fallbackTask.id), [
    {
      kind: 'shared_task_created',
      recipient_user_id: assigneeUserId,
      task_id: fallbackTask.id,
    },
  ])
})

async function seedMember(userId: string, displayName: string): Promise<void> {
  await connection.pool.query(
    `
      insert into app.users (
        id,
        email,
        display_name,
        app_role,
        locale,
        timezone
      )
      values ($1, $2, $3, 'user', 'en-US', 'UTC')
    `,
    [userId, `notification-${userId}@example.test`, displayName],
  )
  await connection.pool.query(
    `
      insert into app.workspace_members (
        id,
        workspace_id,
        user_id,
        role,
        group_role
      )
      values ($1, $2, $3, 'user', 'member')
    `,
    [randomUUID(), workspaceId, userId],
  )
}

async function listNotifications(taskId: string): Promise<NotificationRow[]> {
  const result = await connection.pool.query<NotificationRow>(
    `
      select kind, recipient_user_id, task_id
      from app.shared_task_notifications
      where task_id = $1
      order by kind::text asc
    `,
    [taskId],
  )

  return result.rows
}
