import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { after, before, describe, test } from 'node:test'

import {
  createDatabaseConnection,
  type DatabaseConnection,
  destroyDatabaseConnection,
} from '../../infrastructure/db/client.js'
import { createDatabaseConfig } from '../../infrastructure/db/config.js'
import { PostgresTaskRepository } from './task.repository.postgres.js'

interface Fixture {
  otherTaskId: string
  prefix: string
  projectId: string
  projectTaskId: string
  legacyTaskId: string
  userId: string
  workspaceId: string
}

let connection: DatabaseConnection
let fixture: Fixture

void describe('PostgresTaskRepository', () => {
  void before(async () => {
    connection = createDatabaseConnection(createDatabaseConfig())
    fixture = createFixture()
    await seedFixture(connection, fixture)
  })

  void after(async () => {
    if (fixture) {
      await cleanupFixture(connection, fixture)
    }

    if (connection) {
      await destroyDatabaseConnection(connection)
    }
  })

  void test('paginates legacy project title filters in SQL', async () => {
    const repository = new PostgresTaskRepository(connection.db)
    const context = {
      actorDisplayName: `${fixture.prefix} User`,
      actorUserId: fixture.userId,
      auth: null,
      role: 'owner' as const,
      workspaceKind: 'personal' as const,
      workspaceId: fixture.workspaceId,
    }

    await repository.create({
      context,
      input: createTaskInput({
        id: fixture.projectTaskId,
        project: '',
        projectId: fixture.projectId,
        title: `${fixture.prefix} project task`,
      }),
    })
    await repository.create({
      context,
      input: createTaskInput({
        id: fixture.legacyTaskId,
        project: 'Legacy Filter',
        projectId: null,
        title: `${fixture.prefix} legacy task`,
      }),
    })
    await repository.create({
      context,
      input: createTaskInput({
        id: fixture.otherTaskId,
        project: 'Other',
        projectId: null,
        title: `${fixture.prefix} other task`,
      }),
    })

    const firstPage = await repository.listPageByWorkspace(context, {
      limit: 1,
      offset: 0,
      project: 'Legacy Filter',
    })
    const secondPage = await repository.listPageByWorkspace(context, {
      limit: 1,
      offset: 1,
      project: 'Legacy Filter',
    })
    const pagedTaskIds = [
      ...firstPage.items.map((task) => task.id),
      ...secondPage.items.map((task) => task.id),
    ].sort()

    assert.equal(firstPage.items.length, 1)
    assert.equal(firstPage.hasMore, true)
    assert.equal(firstPage.nextOffset, 1)
    assert.equal(secondPage.items.length, 1)
    assert.equal(secondPage.hasMore, false)
    assert.equal(secondPage.nextOffset, null)
    assert.deepEqual(
      pagedTaskIds,
      [fixture.legacyTaskId, fixture.projectTaskId].sort(),
    )
  })
})

function createFixture(): Fixture {
  const suffix = randomUUID()

  return {
    otherTaskId: randomUUID(),
    prefix: `task-repository-${suffix}`,
    projectId: randomUUID(),
    projectTaskId: randomUUID(),
    legacyTaskId: randomUUID(),
    userId: randomUUID(),
    workspaceId: randomUUID(),
  }
}

async function seedFixture(
  connection: DatabaseConnection,
  value: Fixture,
): Promise<void> {
  await cleanupFixture(connection, value)

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
      values ($1, $2, $3, 'user', 'ru', 'UTC')
    `,
    [value.userId, `${value.prefix}@example.test`, `${value.prefix} User`],
  )
  await connection.pool.query(
    `
      insert into app.workspaces (
        id,
        owner_user_id,
        name,
        slug,
        kind,
        description,
        task_completion_confetti_enabled
      )
      values ($1, $2, $3, $4, 'personal', '', true)
    `,
    [
      value.workspaceId,
      value.userId,
      `${value.prefix} Workspace`,
      value.prefix,
    ],
  )
  await connection.pool.query(
    `
      insert into app.workspace_members (workspace_id, user_id, role)
      values ($1, $2, 'owner')
    `,
    [value.workspaceId, value.userId],
  )
  await connection.pool.query(
    `
      insert into app.projects (
        id,
        workspace_id,
        title,
        description,
        color,
        icon,
        slug,
        position,
        status,
        metadata,
        created_by,
        updated_by
      )
      values ($1, $2, 'Legacy Filter', '', '#2f6f62', 'folder', $3, 0, 'active', '{}', $4, $4)
    `,
    [
      value.projectId,
      value.workspaceId,
      `${value.prefix}-project`,
      value.userId,
    ],
  )
}

async function cleanupFixture(
  connection: DatabaseConnection,
  value: Fixture,
): Promise<void> {
  await connection.pool.query(
    `
      delete from app.task_events
      where workspace_id = $1
    `,
    [value.workspaceId],
  )
  await connection.pool.query(
    `
      delete from app.task_time_blocks
      where workspace_id = $1
    `,
    [value.workspaceId],
  )
  await connection.pool.query(
    `
      delete from app.tasks
      where workspace_id = $1
    `,
    [value.workspaceId],
  )
  await connection.pool.query(
    `
      delete from app.projects
      where workspace_id = $1
    `,
    [value.workspaceId],
  )
  await connection.pool.query(
    `
      delete from app.workspace_members
      where workspace_id = $1
        or user_id = $2
    `,
    [value.workspaceId, value.userId],
  )
  await connection.pool.query(
    `
      delete from app.workspaces
      where id = $1
    `,
    [value.workspaceId],
  )
  await connection.pool.query(
    `
      delete from app.users
      where id = $1
    `,
    [value.userId],
  )
}

function createTaskInput({
  id,
  project,
  projectId,
  title,
}: {
  id: string
  project: string
  projectId: string | null
  title: string
}) {
  return {
    assigneeUserId: null,
    dueDate: null,
    icon: '',
    id,
    importance: 'not_important' as const,
    note: '',
    plannedDate: null,
    plannedEndTime: null,
    plannedStartTime: null,
    project,
    projectId,
    remindBeforeStart: false,
    resource: null,
    requiresConfirmation: false,
    sphereId: null,
    title,
    urgency: 'not_urgent' as const,
  }
}
