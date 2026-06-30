import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { after, before, test } from 'node:test'

import {
  selfCareItemInputSchema,
  selfCareItemUpdateInputSchema,
  selfCareRitualCompletionInputSchema,
} from '@planner/contracts'

import {
  createDatabaseConnection,
  type DatabaseConnection,
  destroyDatabaseConnection,
} from '../../infrastructure/db/client.js'
import { createDatabaseConfig } from '../../infrastructure/db/config.js'
import {
  cleanupRepositoryContractUsers,
  createRepositoryContractAuthContext,
  seedRepositoryContractWorkspace,
} from '../../testing/repository-contract-fixtures.js'
import { PostgresSelfCareRepository } from './self-care.repository.postgres.js'

let connection: DatabaseConnection

void before(() => {
  connection = createDatabaseConnection(createDatabaseConfig())
})

void after(async () => {
  if (connection) {
    await destroyDatabaseConnection(connection)
  }
})

void test('PostgresSelfCareRepository syncs archived migrated items with legacy habits', async () => {
  const actorUserId = randomUUID()
  const habitId = randomUUID()

  await cleanupRepositoryContractUsers(connection, [actorUserId])

  const workspace = await seedRepositoryContractWorkspace(connection, {
    displayName: 'Self Care Migrated Habit User',
    email: `self-care-migrated-${actorUserId}@example.test`,
    kind: 'personal',
    role: 'owner',
    userId: actorUserId,
    workspaceName: 'Self Care Migrated Habits',
  })
  const context = {
    actorUserId,
    auth: createRepositoryContractAuthContext({
      email: workspace.email,
      userId: actorUserId,
    }),
    groupRole: null,
    role: 'owner' as const,
    workspaceId: workspace.workspaceId,
    workspaceKind: 'personal' as const,
  }
  const repository = new PostgresSelfCareRepository(connection.db)

  try {
    await connection.pool.query(
      `
        insert into app.habits (
          id,
          workspace_id,
          user_id,
          title,
          description,
          icon,
          color,
          frequency,
          days_of_week,
          target_type,
          target_value,
          unit,
          start_date,
          is_active,
          sort_order,
          created_by,
          updated_by
        )
        values (
          $1,
          $2,
          $3,
          'Вода',
          '',
          'droplets',
          '#2f6f62',
          'daily',
          array[1, 2, 3, 4, 5, 6, 7]::smallint[],
          'check',
          1,
          '',
          '2026-06-16',
          true,
          0,
          $3,
          $3
        )
      `,
      [habitId, workspace.workspaceId, actorUserId],
    )

    const item = await repository.createItem({
      context,
      input: selfCareItemInputSchema.parse({
        category: 'daily_base',
        migratedFromHabitId: habitId,
        scheduleRule: {
          daysOfWeek: [1, 2, 3, 4, 5, 6, 7],
          repeatKind: 'daily',
          startDate: '2026-06-16',
        },
        title: 'Вода',
        type: 'habit',
      }),
    })

    await repository.archiveItem({ context, itemId: item.id })
    assert.deepEqual(await loadHabitFlags(habitId), {
      deleted: false,
      isActive: false,
    })

    await repository.restoreItem({ context, itemId: item.id })
    assert.deepEqual(await loadHabitFlags(habitId), {
      deleted: false,
      isActive: true,
    })

    await repository.deleteItem({ context, itemId: item.id })
    assert.deepEqual(await loadHabitFlags(habitId), {
      deleted: true,
      isActive: false,
    })
  } finally {
    await cleanupRepositoryContractUsers(connection, [actorUserId])
  }
})

void test('PostgresSelfCareRepository does not duplicate occurrences after schedule rule update', async () => {
  const actorUserId = randomUUID()

  await cleanupRepositoryContractUsers(connection, [actorUserId])

  const workspace = await seedRepositoryContractWorkspace(connection, {
    displayName: 'Self Care Schedule User',
    email: `self-care-schedule-${actorUserId}@example.test`,
    kind: 'personal',
    role: 'owner',
    userId: actorUserId,
    workspaceName: 'Self Care Schedule',
  })
  const context = {
    actorUserId,
    auth: createRepositoryContractAuthContext({
      email: workspace.email,
      userId: actorUserId,
    }),
    groupRole: null,
    role: 'owner' as const,
    workspaceId: workspace.workspaceId,
    workspaceKind: 'personal' as const,
  }
  const repository = new PostgresSelfCareRepository(connection.db)

  try {
    const item = await repository.createItem({
      context,
      input: selfCareItemInputSchema.parse({
        category: 'movement',
        preferredTimeOfDay: 'morning',
        scheduleRule: {
          repeatKind: 'daily',
          startDate: '2026-06-16',
        },
        title: 'Йога',
        type: 'habit',
      }),
    })

    await repository.generateOccurrences({
      context,
      from: '2026-06-16',
      to: '2026-06-16',
    })
    const initialPlan = await repository.getPlan({
      context,
      from: '2026-06-16',
      to: '2026-06-16',
    })
    const initialOccurrence = initialPlan.occurrences[0]?.occurrence

    assert.ok(initialOccurrence)

    await repository.updateItem({
      context,
      input: selfCareItemUpdateInputSchema.parse({
        expectedVersion: item.version,
        preferredTimeOfDay: 'afternoon',
        scheduleRule: {
          repeatKind: 'daily',
          startDate: '2026-06-16',
        },
      }),
      itemId: item.id,
    })

    await repository.generateOccurrences({
      context,
      from: '2026-06-16',
      to: '2026-06-16',
    })
    const plan = await repository.getPlan({
      context,
      from: '2026-06-16',
      to: '2026-06-16',
    })
    const occurrences = plan.occurrences.filter(
      (entry) => entry.item.id === item.id,
    )

    assert.equal(occurrences.length, 1)
    assert.equal(occurrences[0]?.occurrence?.id, initialOccurrence.id)
    assert.equal(
      occurrences[0]?.occurrence?.scheduleRuleId,
      initialOccurrence.scheduleRuleId,
    )
  } finally {
    await cleanupRepositoryContractUsers(connection, [actorUserId])
  }
})

void test('PostgresSelfCareRepository updates open exercise progress when completing an occurrence', async () => {
  const actorUserId = randomUUID()

  await cleanupRepositoryContractUsers(connection, [actorUserId])

  const workspace = await seedRepositoryContractWorkspace(connection, {
    displayName: 'Self Care Exercise User',
    email: `self-care-exercise-${actorUserId}@example.test`,
    kind: 'personal',
    role: 'owner',
    userId: actorUserId,
    workspaceName: 'Self Care Exercise',
  })
  const context = {
    actorUserId,
    auth: createRepositoryContractAuthContext({
      email: workspace.email,
      userId: actorUserId,
    }),
    clientTimeZone: 'Europe/Samara',
    groupRole: null,
    role: 'owner' as const,
    workspaceId: workspace.workspaceId,
    workspaceKind: 'personal' as const,
  }
  const repository = new PostgresSelfCareRepository(connection.db)

  try {
    const item = await repository.createItem({
      context,
      input: selfCareItemInputSchema.parse({
        category: 'movement',
        exerciseDetails: {
          metricType: 'count',
          plannedSets: 3,
          unit: 'reps',
          useSets: true,
        },
        scheduleRule: {
          repeatKind: 'daily',
          startDate: '2026-06-30',
        },
        title: 'Отжимания',
        type: 'exercise',
      }),
    })

    await repository.generateOccurrences({
      context,
      from: '2026-06-30',
      to: '2026-06-30',
    })
    const plan = await repository.getPlan({
      context,
      from: '2026-06-30',
      to: '2026-06-30',
    })
    const occurrence = plan.occurrences.find(
      (entry) => entry.item.id === item.id,
    )?.occurrence

    assert.ok(occurrence)

    const first = await repository.completeItemNow({
      context,
      input: selfCareRitualCompletionInputSchema.parse({
        completedAt: '2026-06-30T08:00:00.000Z',
        exerciseSets: [{ index: 1, value: 8 }],
        measurementUnit: 'reps',
        measurementValue: 8,
        status: 'partial',
      }),
      itemId: item.id,
    })
    const second = await repository.completeItemNow({
      context,
      input: selfCareRitualCompletionInputSchema.parse({
        completedAt: '2026-06-30T08:10:00.000Z',
        exerciseSets: [
          { index: 1, value: 8 },
          { index: 2, value: 10 },
        ],
        measurementUnit: 'reps',
        measurementValue: 18,
        status: 'partial',
      }),
      itemId: item.id,
    })
    const final = await repository.completeOccurrence({
      context,
      input: selfCareRitualCompletionInputSchema.parse({
        completedAt: '2026-06-30T08:20:00.000Z',
        exerciseSets: [
          { index: 1, value: 8 },
          { index: 2, value: 10 },
          { index: 3, value: 10 },
        ],
        measurementUnit: 'reps',
        measurementValue: 28,
        status: 'done',
      }),
      occurrenceId: occurrence.id,
    })
    const history = await repository.getHistory(
      context,
      '2026-06-30',
      '2026-06-30',
    )
    const analytics = await repository.getAnalytics(
      context,
      '2026-06-30',
      '2026-06-30',
    )
    const occurrences = await repository.getOccurrences({
      context,
      from: '2026-06-30',
      to: '2026-06-30',
    })

    assert.equal(second.id, first.id)
    assert.equal(final.id, first.id)
    assert.equal(final.occurrenceId, occurrence.id)
    assert.equal(final.status, 'done')
    assert.equal(final.measurementValue, 28)
    assert.equal(history.completions.length, 1)
    assert.deepEqual(history.completions[0]?.exerciseSets, [
      { index: 1, value: 8 },
      { index: 2, value: 10 },
      { index: 3, value: 10 },
    ])
    assert.equal(analytics.exerciseTrends[0]?.points.length, 1)
    assert.equal(analytics.exerciseTrends[0]?.points[0]?.value, 28)
    assert.equal(
      occurrences.find((entry) => entry.id === occurrence.id)?.status,
      'done',
    )
  } finally {
    await cleanupRepositoryContractUsers(connection, [actorUserId])
  }
})

async function loadHabitFlags(habitId: string) {
  const result = await connection.pool.query<{
    deleted: boolean
    is_active: boolean
  }>(
    `
      select
        deleted_at is not null as deleted,
        is_active
      from app.habits
      where id = $1
    `,
    [habitId],
  )
  const row = result.rows[0]

  assert.ok(row)

  return {
    deleted: row.deleted,
    isActive: row.is_active,
  }
}
