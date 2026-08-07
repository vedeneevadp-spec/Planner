import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { after, before, test } from 'node:test'

import {
  generateUuidV7,
  selfCareItemInputSchema,
  selfCareItemScheduleInputSchema,
  selfCareItemUpdateInputSchema,
  selfCareOfflineCommandRequestSchema,
  selfCareRitualCompletionInputSchema,
  selfCareRitualStepDraftInputSchema,
  selfCareSettingsUpdateInputSchema,
} from '@planner/contracts'

import { HttpError } from '../../bootstrap/http-error.js'
import {
  createDatabaseConnection,
  type DatabaseConnection,
  destroyDatabaseConnection,
} from '../../infrastructure/db/client.js'
import { createDatabaseConfig } from '../../infrastructure/db/config.js'
import { getDatabaseErrorCode } from '../../infrastructure/db/errors.js'
import { withWriteTransaction } from '../../infrastructure/db/rls.js'
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

void test('PostgresSelfCareRepository versions the first persisted settings change after virtual defaults', async () => {
  const actorUserId = randomUUID()

  await cleanupRepositoryContractUsers(connection, [actorUserId])
  const workspace = await seedRepositoryContractWorkspace(connection, {
    displayName: 'Self Care Settings Version User',
    email: `self-care-settings-${actorUserId}@example.test`,
    kind: 'personal',
    role: 'owner',
    userId: actorUserId,
    workspaceName: 'Self Care Settings Version',
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
      'delete from app.self_care_settings where user_id = $1',
      [actorUserId],
    )
    const virtualDefaults = await repository.getSettings(context)
    assert.equal(virtualDefaults.settings.version, 1)

    const legacyUpdate = await repository.updateSettings({
      context,
      input: selfCareSettingsUpdateInputSchema.parse({ currency: 'USD' }),
    })
    assert.equal(legacyUpdate.settings.currency, 'USD')
    assert.equal(legacyUpdate.settings.version, 2)

    const staleOfflineRequest = selfCareOfflineCommandRequestSchema.parse({
      command: {
        expectedVersion: virtualDefaults.settings.version,
        input: { currency: 'EUR' },
        type: 'update_settings',
      },
      operationId: generateUuidV7(),
    })
    await assert.rejects(
      repository.executeOfflineCommand({
        context,
        request: staleOfflineRequest,
      }),
      (error: unknown) =>
        error instanceof HttpError &&
        error.statusCode === 409 &&
        error.code === 'self_care_version_conflict',
    )

    const stored = await repository.getSettings(context)
    assert.equal(stored.settings.currency, 'USD')
    assert.equal(stored.settings.version, 2)
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

void test(
  'PostgresSelfCareRepository serializes competing composite offline commands without a deadlock',
  { timeout: 10_000 },
  async () => {
    const actorUserId = randomUUID()

    await cleanupRepositoryContractUsers(connection, [actorUserId])

    const workspace = await seedRepositoryContractWorkspace(connection, {
      displayName: 'Self Care Offline Concurrency User',
      email: `self-care-offline-concurrency-${actorUserId}@example.test`,
      kind: 'personal',
      role: 'owner',
      userId: actorUserId,
      workspaceName: 'Self Care Offline Concurrency',
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
    const firstRepository = new PostgresSelfCareRepository(connection.db)
    const secondRepository = new PostgresSelfCareRepository(connection.db)

    try {
      const item = await firstRepository.createItem({
        context,
        input: selfCareItemInputSchema.parse({
          category: 'relax',
          description: 'До синхронизации',
          title: 'Тихая пауза',
          type: 'rest_action',
        }),
      })
      const occurrence = await firstRepository.scheduleItem({
        context,
        input: {
          currency: null,
          note: '',
          place: null,
          price: null,
          reminderOffsetsMinutes: [],
          scheduledFor: '2026-08-06',
          scheduledTime: null,
          specialistContact: null,
          specialistName: null,
          timezone: null,
        },
        itemId: item.id,
      })
      const updateAndMove = selfCareOfflineCommandRequestSchema.parse({
        command: {
          expectedVersion: item.version,
          input: { description: 'Из первой операции' },
          itemId: item.id,
          scheduleChange: {
            actedAt: '2026-08-06T09:00:00.000Z',
            completionId: generateUuidV7(),
            expectedVersion: occurrence.version,
            input: { newDate: '2026-08-07' },
            occurrenceId: occurrence.id,
            replacementInput: { scheduledFor: '2026-08-07' },
            replacementOccurrenceId: generateUuidV7(),
            type: 'reschedule',
          },
          type: 'update_item',
        },
        operationId: generateUuidV7(),
      })
      const move = selfCareOfflineCommandRequestSchema.parse({
        command: {
          actedAt: '2026-08-06T09:00:01.000Z',
          completionId: generateUuidV7(),
          expectedVersion: occurrence.version,
          input: { newDate: '2026-08-08' },
          occurrenceId: occurrence.id,
          replacementInput: { scheduledFor: '2026-08-08' },
          replacementOccurrenceId: generateUuidV7(),
          type: 'move_occurrence',
        },
        operationId: generateUuidV7(),
      })

      const outcomes = await Promise.allSettled([
        firstRepository.executeOfflineCommand({
          context,
          request: updateAndMove,
        }),
        secondRepository.executeOfflineCommand({ context, request: move }),
      ])
      const fulfilled = outcomes.filter(
        (outcome) => outcome.status === 'fulfilled',
      )
      const rejected = outcomes.filter(
        (outcome): outcome is PromiseRejectedResult =>
          outcome.status === 'rejected',
      )

      assert.equal(fulfilled.length, 1)
      assert.equal(rejected.length, 1)
      assert.ok(rejected[0]?.reason instanceof HttpError)
      assert.equal(rejected[0]?.reason.statusCode, 409)
      assert.equal(rejected[0]?.reason.code, 'self_care_version_conflict')

      const persisted = await connection.pool.query<{
        scheduled_for: string
        status: string
      }>(
        `
          select scheduled_for::text, status::text
          from app.self_care_occurrences
          where item_id = $1
        `,
        [item.id],
      )
      assert.equal(
        persisted.rows.filter((candidate) => candidate.status === 'moved')
          .length,
        1,
      )
      assert.equal(
        persisted.rows.filter(
          (candidate) =>
            candidate.status === 'scheduled' &&
            ['2026-08-07', '2026-08-08'].includes(candidate.scheduled_for),
        ).length,
        1,
      )
    } finally {
      await cleanupRepositoryContractUsers(connection, [actorUserId])
    }
  },
)

void test(
  'PostgresSelfCareRepository rejects reverse cross-item reschedules before taking the other item lock',
  { timeout: 10_000 },
  async () => {
    const actorUserId = randomUUID()

    await cleanupRepositoryContractUsers(connection, [actorUserId])
    const workspace = await seedRepositoryContractWorkspace(connection, {
      displayName: 'Self Care Cross Item Lock User',
      email: `self-care-cross-item-lock-${actorUserId}@example.test`,
      kind: 'personal',
      role: 'owner',
      userId: actorUserId,
      workspaceName: 'Self Care Cross Item Lock',
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
    const firstRepository = new PostgresSelfCareRepository(connection.db)
    const secondRepository = new PostgresSelfCareRepository(connection.db)

    try {
      const itemA = await firstRepository.createItem({
        context,
        input: selfCareItemInputSchema.parse({
          category: 'relax',
          description: 'Исходное A',
          title: 'Пауза A',
          type: 'rest_action',
        }),
      })
      const itemB = await firstRepository.createItem({
        context,
        input: selfCareItemInputSchema.parse({
          category: 'relax',
          description: 'Исходное B',
          title: 'Пауза B',
          type: 'rest_action',
        }),
      })
      const occurrenceA = await firstRepository.scheduleItem({
        context,
        input: selfCareItemScheduleInputSchema.parse({
          scheduledFor: '2026-08-06',
        }),
        itemId: itemA.id,
      })
      const occurrenceB = await firstRepository.scheduleItem({
        context,
        input: selfCareItemScheduleInputSchema.parse({
          scheduledFor: '2026-08-06',
        }),
        itemId: itemB.id,
      })
      const requestA = selfCareOfflineCommandRequestSchema.parse({
        command: {
          expectedVersion: itemA.version,
          input: { description: 'Не сохранять A' },
          itemId: itemA.id,
          scheduleChange: {
            actedAt: '2026-08-06T09:00:00.000Z',
            completionId: generateUuidV7(),
            expectedVersion: occurrenceB.version,
            input: { newDate: '2026-08-07' },
            occurrenceId: occurrenceB.id,
            replacementInput: { scheduledFor: '2026-08-07' },
            replacementOccurrenceId: generateUuidV7(),
            type: 'reschedule',
          },
          type: 'update_item',
        },
        operationId: generateUuidV7(),
      })
      const requestB = selfCareOfflineCommandRequestSchema.parse({
        command: {
          expectedVersion: itemB.version,
          input: { description: 'Не сохранять B' },
          itemId: itemB.id,
          scheduleChange: {
            actedAt: '2026-08-06T09:00:01.000Z',
            completionId: generateUuidV7(),
            expectedVersion: occurrenceA.version,
            input: { newDate: '2026-08-08' },
            occurrenceId: occurrenceA.id,
            replacementInput: { scheduledFor: '2026-08-08' },
            replacementOccurrenceId: generateUuidV7(),
            type: 'reschedule',
          },
          type: 'update_item',
        },
        operationId: generateUuidV7(),
      })

      const outcomes = await Promise.allSettled([
        firstRepository.executeOfflineCommand({ context, request: requestA }),
        secondRepository.executeOfflineCommand({ context, request: requestB }),
      ])

      assert.equal(
        outcomes.filter((outcome) => outcome.status === 'fulfilled').length,
        0,
      )
      for (const outcome of outcomes) {
        assert.equal(outcome.status, 'rejected')
        if (outcome.status !== 'rejected') continue
        assert.ok(outcome.reason instanceof HttpError)
        assert.equal(outcome.reason.statusCode, 409)
        assert.equal(outcome.reason.code, 'self_care_reschedule_item_conflict')
      }

      const list = await firstRepository.listItems(context)
      const occurrences = await firstRepository.getOccurrences({
        context,
        from: '2026-08-06',
        to: '2026-08-08',
      })
      const history = await firstRepository.getHistory(
        context,
        '2026-08-06',
        '2026-08-08',
      )

      assert.equal(
        list.items.find((item) => item.id === itemA.id)?.description,
        'Исходное A',
      )
      assert.equal(
        list.items.find((item) => item.id === itemB.id)?.description,
        'Исходное B',
      )
      assert.equal(
        occurrences.find((entry) => entry.id === occurrenceA.id)?.status,
        'scheduled',
      )
      assert.equal(
        occurrences.find((entry) => entry.id === occurrenceB.id)?.status,
        'scheduled',
      )
      assert.deepEqual(history.completions, [])
    } finally {
      await cleanupRepositoryContractUsers(connection, [actorUserId])
    }
  },
)

void test('PostgresSelfCareRepository executes offline commands with RLS disabled context', async () => {
  const actorUserId = randomUUID()

  await cleanupRepositoryContractUsers(connection, [actorUserId])
  const workspace = await seedRepositoryContractWorkspace(connection, {
    displayName: 'Self Care Offline No RLS User',
    email: `self-care-offline-no-rls-${actorUserId}@example.test`,
    kind: 'personal',
    role: 'owner',
    userId: actorUserId,
    workspaceName: 'Self Care Offline No RLS',
  })
  const context = {
    actorUserId,
    auth: null,
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
        category: 'relax',
        title: 'Пауза без RLS',
        type: 'rest_action',
      }),
    })
    const request = selfCareOfflineCommandRequestSchema.parse({
      command: {
        expectedVersion: item.version,
        itemId: item.id,
        type: 'archive_item',
      },
      operationId: generateUuidV7(),
    })

    const result = await repository.executeOfflineCommand({ context, request })
    const replay = await repository.executeOfflineCommand({ context, request })
    assert.equal(result.replayed, false)
    assert.equal(replay.replayed, true)
    assert.deepEqual(replay.result, result.result)
    assert.equal(result.result.kind, 'item')
    assert.equal(
      result.result.kind === 'item' ? result.result.item.isArchived : false,
      true,
    )
    await assert.rejects(
      repository.executeOfflineCommand({
        context,
        request: selfCareOfflineCommandRequestSchema.parse({
          command: {
            expectedVersion: item.version + 1,
            itemId: item.id,
            type: 'archive_item',
          },
          operationId: request.operationId,
        }),
      }),
      isHttpConflict('self_care_operation_id_reused'),
    )
  } finally {
    await cleanupRepositoryContractUsers(connection, [actorUserId])
  }
})

void test('PostgresSelfCareRepository returns and replays the persisted completion receipt', async () => {
  const actorUserId = randomUUID()

  await cleanupRepositoryContractUsers(connection, [actorUserId])
  const workspace = await seedRepositoryContractWorkspace(connection, {
    displayName: 'Self Care Persisted Receipt User',
    email: `self-care-persisted-receipt-${actorUserId}@example.test`,
    kind: 'personal',
    role: 'owner',
    userId: actorUserId,
    workspaceName: 'Self Care Persisted Receipt',
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
        category: 'relax',
        title: 'Пауза с отложенной синхронизацией',
        type: 'rest_action',
      }),
    })
    const completedAt = '2026-07-01T08:00:00.000Z'
    const request = selfCareOfflineCommandRequestSchema.parse({
      command: {
        completionId: generateUuidV7(),
        expectedVersion: item.version,
        input: { completedAt, status: 'done' },
        itemId: item.id,
        type: 'complete_item_now',
      },
      operationId: generateUuidV7(),
    })

    const first = await repository.executeOfflineCommand({ context, request })
    const replay = await repository.executeOfflineCommand({ context, request })
    const history = await repository.getHistory(
      context,
      '2026-07-01',
      '2026-07-01',
    )

    assert.equal(first.result.kind, 'completion')
    assert.equal(replay.replayed, true)
    assert.deepEqual(replay.result, first.result)
    assert.equal(history.completions.length, 1)
    if (first.result.kind === 'completion') {
      assert.equal(first.result.completion.completedAt, completedAt)
      assert.notEqual(first.result.completion.createdAt, completedAt)
      assert.deepEqual(first.result.completion, history.completions[0])
    }
  } finally {
    await cleanupRepositoryContractUsers(connection, [actorUserId])
  }
})

void test('PostgresSelfCareRepository updates same-date schedule details offline without recording a move', async () => {
  const actorUserId = randomUUID()

  await cleanupRepositoryContractUsers(connection, [actorUserId])
  const workspace = await seedRepositoryContractWorkspace(connection, {
    displayName: 'Self Care Same Date Schedule User',
    email: `self-care-same-date-schedule-${actorUserId}@example.test`,
    kind: 'personal',
    role: 'owner',
    userId: actorUserId,
    workspaceName: 'Self Care Same Date Schedule',
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
        category: 'relax',
        title: 'Пауза',
        type: 'rest_action',
      }),
    })
    const occurrence = await repository.scheduleItem({
      context,
      input: selfCareItemScheduleInputSchema.parse({
        place: 'Дома',
        scheduledFor: '2026-08-06',
        scheduledTime: '10:00',
        timezone: 'Europe/Samara',
      }),
      itemId: item.id,
    })
    const request = selfCareOfflineCommandRequestSchema.parse({
      clientTimeZone: 'Europe/Samara',
      command: {
        existingOccurrenceId: occurrence.id,
        expectedOccurrenceVersion: occurrence.version,
        expectedVersion: item.version,
        input: {
          note: 'Взять плед',
          place: 'На балконе',
          scheduledFor: occurrence.scheduledFor,
          scheduledTime: '11:30',
          timezone: 'Europe/Samara',
        },
        itemId: item.id,
        type: 'schedule_item',
      },
      operationId: generateUuidV7(),
    })

    const result = await repository.executeOfflineCommand({ context, request })
    const replay = await repository.executeOfflineCommand({ context, request })

    assert.equal(result.result.kind, 'occurrence')
    assert.equal(replay.replayed, true)
    assert.deepEqual(replay.result, result.result)
    assert.equal(result.result.occurrence.id, occurrence.id)
    assert.equal(result.result.occurrence.version, occurrence.version + 1)
    assert.equal(result.result.occurrence.status, 'scheduled')
    assert.equal(result.result.occurrence.dueAt, '2026-08-06T07:30:00.000Z')
    const list = await repository.listItems(context)
    const details = list.appointmentDetails.find(
      (candidate) => candidate.occurrenceId === occurrence.id,
    )
    assert.equal(
      list.items.find((candidate) => candidate.id === item.id)?.version,
      item.version,
    )
    assert.equal(details?.place, 'На балконе')
    assert.equal(details?.preparationNote, 'Взять плед')
    assert.equal(details?.startsAt, '2026-08-06T07:30:00.000Z')
    assert.deepEqual(
      (await repository.getHistory(context, '2026-08-06', '2026-08-06'))
        .completions,
      [],
    )

    await assert.rejects(
      repository.executeOfflineCommand({
        context,
        request: selfCareOfflineCommandRequestSchema.parse({
          command: {
            existingOccurrenceId: occurrence.id,
            expectedOccurrenceVersion: occurrence.version,
            expectedVersion: item.version,
            input: {
              scheduledFor: occurrence.scheduledFor,
              scheduledTime: '12:00',
            },
            itemId: item.id,
            type: 'schedule_item',
          },
          operationId: generateUuidV7(),
        }),
      }),
      isHttpConflict('self_care_version_conflict'),
    )
    await assert.rejects(
      repository.executeOfflineCommand({
        context,
        request: selfCareOfflineCommandRequestSchema.parse({
          command: {
            existingOccurrenceId: occurrence.id,
            expectedOccurrenceVersion: result.result.occurrence.version,
            expectedVersion: item.version,
            input: { scheduledFor: '2026-08-07' },
            itemId: item.id,
            type: 'schedule_item',
          },
          operationId: generateUuidV7(),
        }),
      }),
      isHttpConflict('self_care_schedule_date_conflict'),
    )

    const persisted = await connection.pool.query<{
      completion_count: string
      occurrence_count: string
      status: string
    }>(
      `
        select
          (select count(*)::text from app.self_care_completions where item_id = $1) as completion_count,
          (select count(*)::text from app.self_care_occurrences where item_id = $1) as occurrence_count,
          (select status::text from app.self_care_occurrences where id = $2) as status
      `,
      [item.id, occurrence.id],
    )
    assert.deepEqual(persisted.rows[0], {
      completion_count: '0',
      occurrence_count: '1',
      status: 'scheduled',
    })
  } finally {
    await cleanupRepositoryContractUsers(connection, [actorUserId])
  }
})

void test('PostgresSelfCareRepository atomically updates an item and same-date schedule details without move history', async () => {
  const actorUserId = randomUUID()

  await cleanupRepositoryContractUsers(connection, [actorUserId])
  const workspace = await seedRepositoryContractWorkspace(connection, {
    displayName: 'Self Care Atomic Schedule Update User',
    email: `self-care-atomic-schedule-update-${actorUserId}@example.test`,
    kind: 'personal',
    role: 'owner',
    userId: actorUserId,
    workspaceName: 'Self Care Atomic Schedule Update',
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
        category: 'relax',
        description: 'До изменения',
        title: 'Тихая пауза',
        type: 'rest_action',
      }),
    })
    const occurrence = await repository.scheduleItem({
      context,
      input: selfCareItemScheduleInputSchema.parse({
        scheduledFor: '2026-08-06',
        scheduledTime: '10:00',
        timezone: 'Europe/Samara',
      }),
      itemId: item.id,
    })
    const request = selfCareOfflineCommandRequestSchema.parse({
      clientTimeZone: 'Europe/Samara',
      command: {
        expectedVersion: item.version,
        input: { description: 'После изменения' },
        itemId: item.id,
        scheduleChange: {
          expectedVersion: occurrence.version,
          input: {
            note: 'Взять плед',
            place: 'На балконе',
            scheduledFor: occurrence.scheduledFor,
            scheduledTime: '11:30',
            timezone: 'Europe/Samara',
          },
          occurrenceId: occurrence.id,
          type: 'update_schedule',
        },
        type: 'update_item',
      },
      operationId: generateUuidV7(),
    })

    const response = await repository.executeOfflineCommand({
      context,
      request,
    })

    assert.equal(response.result.kind, 'item')
    assert.ok(response.result.kind === 'item' && response.result.occurrence)
    assert.equal(response.result.item.description, 'После изменения')
    assert.equal(response.result.item.version, item.version + 1)
    assert.equal(response.result.occurrence.id, occurrence.id)
    assert.equal(response.result.occurrence.version, occurrence.version + 1)
    assert.equal(response.result.occurrence.status, 'scheduled')
    assert.equal(response.result.occurrence.movedTo, null)
    assert.equal(response.result.replacement, undefined)

    await assert.rejects(
      repository.executeOfflineCommand({
        context,
        request: selfCareOfflineCommandRequestSchema.parse({
          command: {
            expectedVersion: response.result.item.version,
            input: { description: 'Не должно сохраниться' },
            itemId: item.id,
            scheduleChange: {
              expectedVersion: occurrence.version,
              input: {
                scheduledFor: occurrence.scheduledFor,
                scheduledTime: '12:00',
              },
              occurrenceId: occurrence.id,
              type: 'update_schedule',
            },
            type: 'update_item',
          },
          operationId: generateUuidV7(),
        }),
      }),
      isHttpConflict('self_care_version_conflict'),
    )

    const persisted = await connection.pool.query<{
      completion_count: string
      description: string
      item_version: string
      occurrence_version: string
      status: string
    }>(
      `
        select
          item.description,
          item.version::text as item_version,
          occurrence.version::text as occurrence_version,
          occurrence.status::text as status,
          (
            select count(*)::text
            from app.self_care_completions completion
            where completion.item_id = item.id
          ) as completion_count
        from app.self_care_items item
        join app.self_care_occurrences occurrence
          on occurrence.id = $2
         and occurrence.item_id = item.id
        where item.id = $1
      `,
      [item.id, occurrence.id],
    )
    assert.deepEqual(persisted.rows[0], {
      completion_count: '0',
      description: 'После изменения',
      item_version: String(item.version + 1),
      occurrence_version: String(occurrence.version + 1),
      status: 'scheduled',
    })
  } finally {
    await cleanupRepositoryContractUsers(connection, [actorUserId])
  }
})

void test('PostgresSelfCareRepository consumes one item version and clears the draft for a deduplicated completion command', async () => {
  const actorUserId = randomUUID()

  await cleanupRepositoryContractUsers(connection, [actorUserId])
  const workspace = await seedRepositoryContractWorkspace(connection, {
    displayName: 'Self Care Deduplicated Completion User',
    email: `self-care-deduplicated-completion-${actorUserId}@example.test`,
    kind: 'personal',
    role: 'owner',
    userId: actorUserId,
    workspaceName: 'Self Care Deduplicated Completion',
  })
  const context = {
    actorUserId,
    auth: createRepositoryContractAuthContext({
      email: workspace.email,
      userId: actorUserId,
    }),
    clientTimeZone: 'UTC',
    groupRole: null,
    role: 'owner' as const,
    workspaceId: workspace.workspaceId,
    workspaceKind: 'personal' as const,
  }
  const repository = new PostgresSelfCareRepository(connection.db)
  const competingRepository = new PostgresSelfCareRepository(connection.db)

  try {
    const item = await repository.createItem({
      context,
      input: selfCareItemInputSchema.parse({
        category: 'daily_base',
        steps: [{ title: 'Умыться' }],
        title: 'Утренний ритуал',
        type: 'ritual',
      }),
    })
    const step = (await repository.listItems(context)).steps.find(
      (candidate) => candidate.itemId === item.id,
    )
    assert.ok(step)
    const completionInput = {
      completedAt: '2026-08-06T08:00:00.000Z',
      status: 'done' as const,
      steps: [{ isDone: true, stepId: step.id }],
    }
    const first = await repository.executeOfflineCommand({
      context,
      request: selfCareOfflineCommandRequestSchema.parse({
        clientTimeZone: 'UTC',
        command: {
          completionId: generateUuidV7(),
          expectedVersion: item.version,
          input: completionInput,
          itemId: item.id,
          type: 'complete_item_now',
        },
        operationId: generateUuidV7(),
      }),
    })
    assert.equal(first.result.kind, 'completion')
    assert.ok(first.result.kind === 'completion' && first.result.item)
    assert.equal(first.result.item.version, item.version + 1)

    await repository.upsertRitualStepDraft({
      context,
      expectedVersion: null,
      input: selfCareRitualStepDraftInputSchema.parse({
        date: '2026-08-06',
        itemId: item.id,
        occurrenceId: null,
        stepIds: [step.id],
      }),
    })

    const duplicateRequests = [
      selfCareOfflineCommandRequestSchema.parse({
        clientTimeZone: 'UTC',
        command: {
          completionId: generateUuidV7(),
          expectedVersion: first.result.item.version,
          input: completionInput,
          itemId: item.id,
          type: 'complete_item_now',
        },
        operationId: generateUuidV7(),
      }),
      selfCareOfflineCommandRequestSchema.parse({
        clientTimeZone: 'UTC',
        command: {
          completionId: generateUuidV7(),
          expectedVersion: first.result.item.version,
          input: completionInput,
          itemId: item.id,
          type: 'complete_item_now',
        },
        operationId: generateUuidV7(),
      }),
    ] as const
    const outcomes = await Promise.allSettled([
      repository.executeOfflineCommand({
        context,
        request: duplicateRequests[0],
      }),
      competingRepository.executeOfflineCommand({
        context,
        request: duplicateRequests[1],
      }),
    ])
    const fulfilled = outcomes.filter(
      (
        outcome,
      ): outcome is PromiseFulfilledResult<
        Awaited<ReturnType<typeof repository.executeOfflineCommand>>
      > => outcome.status === 'fulfilled',
    )
    const rejected = outcomes.filter(
      (outcome): outcome is PromiseRejectedResult =>
        outcome.status === 'rejected',
    )

    assert.equal(fulfilled.length, 1)
    assert.equal(rejected.length, 1)
    assert.ok(rejected[0]?.reason instanceof HttpError)
    assert.equal(rejected[0]?.reason.statusCode, 409)
    assert.equal(rejected[0]?.reason.code, 'self_care_version_conflict')
    const accepted = fulfilled[0]?.value
    assert.ok(accepted)
    assert.equal(accepted.result.kind, 'completion')
    assert.ok(accepted.result.kind === 'completion' && accepted.result.item)
    assert.equal(accepted.result.completion.id, first.result.completion.id)
    assert.equal(accepted.result.item.version, first.result.item.version + 1)
    assert.deepEqual(
      (
        await repository.getRitualStepDrafts({
          context,
          date: '2026-08-06',
        })
      ).drafts,
      [],
    )

    const updated = await repository.executeOfflineCommand({
      context,
      request: selfCareOfflineCommandRequestSchema.parse({
        command: {
          expectedVersion: accepted.result.item.version,
          input: { title: 'Утренний ритуал — обновлён' },
          itemId: item.id,
          type: 'update_item',
        },
        operationId: generateUuidV7(),
      }),
    })
    assert.equal(updated.result.kind, 'item')
    assert.equal(updated.result.item.version, accepted.result.item.version + 1)
  } finally {
    await cleanupRepositoryContractUsers(connection, [actorUserId])
  }
})

void test('PostgresSelfCareRepository rejects same-item and cross-user ritual step violations without partial writes', async () => {
  const firstUserId = randomUUID()
  const secondUserId = randomUUID()
  const userIds = [firstUserId, secondUserId]

  await cleanupRepositoryContractUsers(connection, userIds)
  const firstWorkspace = await seedRepositoryContractWorkspace(connection, {
    displayName: 'Self Care Step Isolation First User',
    email: `self-care-step-isolation-first-${firstUserId}@example.test`,
    kind: 'personal',
    role: 'owner',
    userId: firstUserId,
    workspaceName: 'Self Care Step Isolation First',
  })
  const secondWorkspace = await seedRepositoryContractWorkspace(connection, {
    displayName: 'Self Care Step Isolation Second User',
    email: `self-care-step-isolation-second-${secondUserId}@example.test`,
    kind: 'personal',
    role: 'owner',
    userId: secondUserId,
    workspaceName: 'Self Care Step Isolation Second',
  })
  const firstContext = {
    actorUserId: firstUserId,
    auth: createRepositoryContractAuthContext({
      email: firstWorkspace.email,
      userId: firstUserId,
    }),
    clientTimeZone: 'UTC',
    groupRole: null,
    role: 'owner' as const,
    workspaceId: firstWorkspace.workspaceId,
    workspaceKind: 'personal' as const,
  }
  const secondContext = {
    actorUserId: secondUserId,
    auth: createRepositoryContractAuthContext({
      email: secondWorkspace.email,
      userId: secondUserId,
    }),
    clientTimeZone: 'UTC',
    groupRole: null,
    role: 'owner' as const,
    workspaceId: secondWorkspace.workspaceId,
    workspaceKind: 'personal' as const,
  }
  const repository = new PostgresSelfCareRepository(connection.db)

  try {
    const foreignRitual = await repository.createItem({
      context: firstContext,
      input: selfCareItemInputSchema.parse({
        category: 'daily_base',
        steps: [{ title: 'Шаг первого пользователя' }],
        title: 'Ритуал первого пользователя',
        type: 'ritual',
      }),
    })
    const foreignStep = (await repository.listItems(firstContext)).steps.find(
      (step) => step.itemId === foreignRitual.id,
    )
    assert.ok(foreignStep)

    const ownRitual = await repository.createItem({
      context: secondContext,
      input: selfCareItemInputSchema.parse({
        category: 'daily_base',
        steps: [{ title: 'Шаг другого ритуала' }],
        title: 'Другой ритуал второго пользователя',
        type: 'ritual',
      }),
    })
    const ownOtherItemStep = (
      await repository.listItems(secondContext)
    ).steps.find((step) => step.itemId === ownRitual.id)
    assert.ok(ownOtherItemStep)

    const courseItem = await repository.createItem({
      context: secondContext,
      input: selfCareItemInputSchema.parse({
        category: 'medical',
        courseDetails: {
          courseType: 'sessions',
          endDate: null,
          startDate: '2026-08-06',
          totalCount: 3,
        },
        title: 'Курс второго пользователя',
        type: 'course',
      }),
    })
    const occurrence = await repository.scheduleItem({
      context: secondContext,
      input: selfCareItemScheduleInputSchema.parse({
        scheduledFor: '2026-08-06',
      }),
      itemId: courseItem.id,
    })
    const courseBefore = (
      await repository.listItems(secondContext)
    ).courseDetails.find((course) => course.itemId === courseItem.id)
    assert.ok(courseBefore)

    await assert.rejects(
      repository.completeItemNow({
        completionId: generateUuidV7(),
        context: secondContext,
        expectedVersion: courseItem.version,
        input: selfCareRitualCompletionInputSchema.parse({
          completedAt: '2026-08-06T08:00:00.000Z',
          status: 'done',
          steps: [{ isDone: true, stepId: ownOtherItemStep.id }],
        }),
        itemId: courseItem.id,
      }),
      isHttpConflict('self_care_ritual_step_conflict'),
    )
    await assert.rejects(
      repository.completeOccurrence({
        completionId: generateUuidV7(),
        context: secondContext,
        expectedVersion: occurrence.version,
        input: selfCareRitualCompletionInputSchema.parse({
          completedAt: '2026-08-06T09:00:00.000Z',
          status: 'done',
          steps: [{ isDone: true, stepId: foreignStep.id }],
        }),
        occurrenceId: occurrence.id,
      }),
      isHttpConflict('self_care_ritual_step_conflict'),
    )

    const courseItemAfter = (
      await repository.listItems(secondContext)
    ).items.find((item) => item.id === courseItem.id)
    const courseAfter = (
      await repository.listItems(secondContext)
    ).courseDetails.find((course) => course.itemId === courseItem.id)
    const occurrenceAfter = (
      await repository.getOccurrences({
        context: secondContext,
        from: '2026-08-06',
        to: '2026-08-06',
      })
    ).find((candidate) => candidate.id === occurrence.id)
    const historyAfterRejectedCommands = await repository.getHistory(
      secondContext,
      '2026-08-06',
      '2026-08-06',
    )

    assert.equal(courseItemAfter?.version, courseItem.version)
    assert.deepEqual(courseAfter, courseBefore)
    assert.equal(occurrenceAfter?.status, 'scheduled')
    assert.equal(occurrenceAfter?.version, occurrence.version)
    assert.deepEqual(historyAfterRejectedCommands.completions, [])
    assert.deepEqual(historyAfterRejectedCommands.stepCompletions, [])

    const receiptItem = await repository.createItem({
      context: secondContext,
      input: selfCareItemInputSchema.parse({
        category: 'relax',
        title: 'Проверка RLS',
        type: 'rest_action',
      }),
    })
    const completion = await repository.completeItemNow({
      completionId: generateUuidV7(),
      context: secondContext,
      expectedVersion: receiptItem.version,
      input: selfCareRitualCompletionInputSchema.parse({
        completedAt: '2026-08-07T08:00:00.000Z',
        status: 'done',
      }),
      itemId: receiptItem.id,
    })

    for (const invalidStepId of [ownOtherItemStep.id, foreignStep.id]) {
      await assert.rejects(
        withWriteTransaction(
          connection.db,
          secondContext.auth,
          (trx) =>
            trx
              .insertInto('app.self_care_ritual_step_completions')
              .values({
                completion_id: completion.id,
                id: randomUUID(),
                is_done: true,
                step_id: invalidStepId,
              })
              .execute(),
          secondUserId,
        ),
        (error: unknown) => getDatabaseErrorCode(error) === '42501',
      )
    }
  } finally {
    await cleanupRepositoryContractUsers(connection, userIds)
  }
})

void test('PostgresSelfCareRepository returns neutral conflicts for client ids owned by another user', async () => {
  const firstUserId = randomUUID()
  const secondUserId = randomUUID()
  const userIds = [firstUserId, secondUserId]

  await cleanupRepositoryContractUsers(connection, userIds)
  const firstWorkspace = await seedRepositoryContractWorkspace(connection, {
    displayName: 'Self Care Client Id First User',
    email: `self-care-client-id-first-${firstUserId}@example.test`,
    kind: 'personal',
    role: 'owner',
    userId: firstUserId,
    workspaceName: 'Self Care Client Id First',
  })
  const secondWorkspace = await seedRepositoryContractWorkspace(connection, {
    displayName: 'Self Care Client Id Second User',
    email: `self-care-client-id-second-${secondUserId}@example.test`,
    kind: 'personal',
    role: 'owner',
    userId: secondUserId,
    workspaceName: 'Self Care Client Id Second',
  })
  const firstContext = {
    actorUserId: firstUserId,
    auth: null,
    groupRole: null,
    role: 'owner' as const,
    workspaceId: firstWorkspace.workspaceId,
    workspaceKind: 'personal' as const,
  }
  const secondContext = {
    actorUserId: secondUserId,
    auth: null,
    groupRole: null,
    role: 'owner' as const,
    workspaceId: secondWorkspace.workspaceId,
    workspaceKind: 'personal' as const,
  }
  const repository = new PostgresSelfCareRepository(connection.db)
  const sharedItemId = generateUuidV7()
  const sharedOccurrenceId = generateUuidV7()
  const sharedCompletionId = generateUuidV7()
  const sharedStepId = generateUuidV7()

  try {
    const deletedItem = await repository.createItem({
      context: firstContext,
      input: selfCareItemInputSchema.parse({
        category: 'relax',
        id: sharedItemId,
        title: 'Удалённая запись первого пользователя',
        type: 'rest_action',
      }),
    })
    await repository.deleteItem({
      context: firstContext,
      itemId: deletedItem.id,
    })

    await assert.rejects(
      repository.executeOfflineCommand({
        context: secondContext,
        request: selfCareOfflineCommandRequestSchema.parse({
          command: {
            input: {
              category: 'relax',
              id: sharedItemId,
              title: 'Запись второго пользователя',
              type: 'rest_action',
            },
            type: 'create_item',
          },
          operationId: generateUuidV7(),
        }),
      }),
      isHttpConflict('self_care_item_id_conflict'),
    )

    const firstItem = await repository.createItem({
      context: firstContext,
      input: selfCareItemInputSchema.parse({
        category: 'relax',
        steps: [{ id: sharedStepId, title: 'Шаг первого пользователя' }],
        title: 'Активная запись первого пользователя',
        type: 'ritual',
      }),
    })
    const secondItem = await repository.createItem({
      context: secondContext,
      input: selfCareItemInputSchema.parse({
        category: 'relax',
        title: 'Активная запись второго пользователя',
        type: 'rest_action',
      }),
    })
    await repository.scheduleItem({
      context: firstContext,
      input: {
        currency: null,
        note: '',
        place: null,
        price: null,
        reminderOffsetsMinutes: [],
        scheduledFor: '2026-08-06',
        scheduledTime: null,
        specialistContact: null,
        specialistName: null,
        timezone: null,
      },
      itemId: firstItem.id,
      occurrenceId: sharedOccurrenceId,
      strictInsert: true,
    })

    await assert.rejects(
      repository.executeOfflineCommand({
        context: secondContext,
        request: selfCareOfflineCommandRequestSchema.parse({
          command: {
            expectedVersion: secondItem.version,
            input: { scheduledFor: '2026-08-07' },
            itemId: secondItem.id,
            occurrenceId: sharedOccurrenceId,
            type: 'schedule_item',
          },
          operationId: generateUuidV7(),
        }),
      }),
      isHttpConflict('self_care_occurrence_id_conflict'),
    )

    await assert.rejects(
      repository.executeOfflineCommand({
        context: secondContext,
        request: selfCareOfflineCommandRequestSchema.parse({
          command: {
            expectedVersion: secondItem.version,
            input: {
              steps: [{ id: sharedStepId, title: 'Шаг второго пользователя' }],
            },
            itemId: secondItem.id,
            type: 'update_item',
          },
          operationId: generateUuidV7(),
        }),
      }),
      isHttpConflict('self_care_item_id_conflict'),
    )
    const firstListAfterCollision = await repository.listItems(firstContext)
    assert.equal(
      firstListAfterCollision.steps.find((step) => step.id === sharedStepId)
        ?.title,
      'Шаг первого пользователя',
    )
    assert.equal(
      (await repository.listItems(secondContext)).items[0]?.version,
      secondItem.version,
    )

    await repository.completeItemNow({
      completionId: sharedCompletionId,
      context: firstContext,
      expectedVersion: firstItem.version,
      input: selfCareRitualCompletionInputSchema.parse({
        completedAt: '2026-08-06T10:00:00.000Z',
        status: 'done',
      }),
      itemId: firstItem.id,
    })
    await assert.rejects(
      repository.executeOfflineCommand({
        context: secondContext,
        request: selfCareOfflineCommandRequestSchema.parse({
          command: {
            completionId: sharedCompletionId,
            expectedVersion: secondItem.version,
            input: {
              completedAt: '2026-08-06T10:01:00.000Z',
              status: 'done',
            },
            itemId: secondItem.id,
            type: 'complete_item_now',
          },
          operationId: generateUuidV7(),
        }),
      }),
      isHttpConflict('self_care_completion_id_conflict'),
    )
  } finally {
    await cleanupRepositoryContractUsers(connection, userIds)
  }
})

function isHttpConflict(code: string) {
  return (error: unknown) =>
    error instanceof HttpError &&
    error.statusCode === 409 &&
    error.code === code
}

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
