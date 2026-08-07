import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import test from 'node:test'

import {
  generateUuidV7,
  selfCareCompletionInputSchema,
  selfCareCompletionUpdateInputSchema,
  selfCareItemInputSchema,
  selfCareItemScheduleInputSchema,
  selfCareItemUpdateInputSchema,
  selfCareOccurrenceSkipInputSchema,
  selfCareOfflineCommandRequestSchema,
  selfCareRitualCompletionInputSchema,
  selfCareRitualStepDraftInputSchema,
} from '@planner/contracts'

import { HttpError } from '../../bootstrap/http-error.js'
import type { SelfCareWriteContext } from './self-care.model.js'
import { MemorySelfCareRepository } from './self-care.repository.memory.js'
import { addDays, getDateKey } from './self-care.shared.js'

void test('self-care offline schedule commands require either a new id or a complete existing-occurrence version pair', () => {
  const base = {
    command: {
      expectedVersion: 1,
      input: { scheduledFor: '2026-08-06' },
      itemId: generateUuidV7(),
      type: 'schedule_item' as const,
    },
    operationId: generateUuidV7(),
  }

  assert.equal(
    selfCareOfflineCommandRequestSchema.safeParse({
      ...base,
      command: { ...base.command, occurrenceId: generateUuidV7() },
    }).success,
    true,
  )
  assert.equal(
    selfCareOfflineCommandRequestSchema.safeParse({
      ...base,
      command: {
        ...base.command,
        existingOccurrenceId: randomUUID(),
        expectedOccurrenceVersion: 2,
      },
    }).success,
    true,
  )
  assert.equal(
    selfCareOfflineCommandRequestSchema.safeParse(base).success,
    false,
  )
  assert.equal(
    selfCareOfflineCommandRequestSchema.safeParse({
      ...base,
      command: {
        ...base.command,
        existingOccurrenceId: randomUUID(),
      },
    }).success,
    false,
  )
  assert.equal(
    selfCareOfflineCommandRequestSchema.safeParse({
      ...base,
      command: {
        ...base.command,
        expectedOccurrenceVersion: 2,
      },
    }).success,
    false,
  )
})

void test('MemorySelfCareRepository reactivates an existing occurrence when it is scheduled again', async () => {
  const repository = new MemorySelfCareRepository()
  const context = createWriteContext()
  const item = await repository.createItem({
    context,
    input: selfCareItemInputSchema.parse({
      category: 'relax',
      scheduleRule: {
        intervalUnit: 'week',
        intervalValue: 5,
        repeatKind: 'after_completion',
        startDate: '2026-06-08',
      },
      title: 'Массаж',
      type: 'procedure',
    }),
  })
  const input = selfCareItemScheduleInputSchema.parse({
    currency: 'RUB',
    note: 'Description',
    place: 'Osgood',
    price: 3500,
    scheduledFor: '2026-06-08',
    scheduledTime: '22:23',
    specialistContact: '3334555',
    specialistName: 'ИРа',
  })
  const occurrence = await repository.scheduleItem({
    context,
    input,
    itemId: item.id,
  })

  await repository.skipOccurrence({
    context,
    input: selfCareOccurrenceSkipInputSchema.parse({
      reason: 'Сегодня не получилось.',
    }),
    occurrenceId: occurrence.id,
  })

  const rescheduled = await repository.scheduleItem({
    context,
    input,
    itemId: item.id,
  })
  const dashboard = await repository.getDashboard({
    context,
    date: input.scheduledFor,
  })
  const plan = await repository.getPlan({
    context,
    from: input.scheduledFor,
    to: input.scheduledFor,
  })

  assert.equal(rescheduled.id, occurrence.id)
  assert.equal(rescheduled.status, 'scheduled')
  assert.equal(rescheduled.completedAt, null)
  assert.equal(rescheduled.movedTo, null)
  assert.equal(rescheduled.dueAt, '2026-06-08T22:23:00.000Z')
  assert.equal(dashboard.todayItems[0]?.item.id, item.id)
  assert.equal(dashboard.todayItems[0]?.completion, null)
  assert.deepEqual(
    dashboard.planningHints.map((entry) => entry.item.id),
    [],
  )
  assert.equal(plan.occurrences[0]?.item.id, item.id)
  assert.deepEqual(
    plan.planningHints.map((entry) => entry.item.id),
    [],
  )
})

void test('MemorySelfCareRepository stores scheduled local time as a fixed-zone instant', async () => {
  const repository = new MemorySelfCareRepository()
  const context = createWriteContext()
  const item = await repository.createItem({
    context,
    input: selfCareItemInputSchema.parse({
      category: 'relax',
      scheduleRule: {
        intervalUnit: 'week',
        intervalValue: 5,
        repeatKind: 'after_completion',
        startDate: '2026-06-25',
      },
      title: 'Массаж',
      type: 'procedure',
    }),
  })
  const occurrence = await repository.scheduleItem({
    context,
    input: selfCareItemScheduleInputSchema.parse({
      scheduledFor: '2026-06-25',
      scheduledTime: '18:00',
      timezone: 'Europe/Astrakhan',
    }),
    itemId: item.id,
  })

  assert.equal(occurrence.dueAt, '2026-06-25T14:00:00.000Z')
  assert.equal(occurrence.reminderTimeZone, 'Europe/Astrakhan')
})

void test('MemorySelfCareRepository updates same-date schedule details offline without recording a move', async () => {
  const repository = new MemorySelfCareRepository()
  const context = createWriteContext()
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
    isConflict('self_care_version_conflict'),
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
    isConflict('self_care_schedule_date_conflict'),
  )
  assert.deepEqual(
    (await repository.getHistory(context, '2026-08-06', '2026-08-07'))
      .completions,
    [],
  )
})

void test('MemorySelfCareRepository keeps stale daily occurrences overdue', async () => {
  const repository = new MemorySelfCareRepository()
  const context = createWriteContext()
  await repository.createItem({
    context,
    input: selfCareItemInputSchema.parse({
      category: 'daily_base',
      scheduleRule: {
        repeatKind: 'daily',
        startDate: '2026-06-08',
      },
      title: 'Вода',
      type: 'habit',
    }),
  })

  await repository.generateOccurrences({
    context,
    from: '2026-06-08',
    to: '2026-06-08',
  })
  const dashboard = await repository.getDashboard({
    context,
    date: '2026-06-09',
  })
  const occurrences = await repository.getOccurrences({
    context,
    from: '2026-06-08',
    to: '2026-06-08',
  })

  assert.equal(occurrences[0]?.status, 'scheduled')
  assert.deepEqual(
    dashboard.overdueItems.map((entry) => entry.occurrence?.id),
    [occurrences[0]?.id],
  )
})

void test('MemorySelfCareRepository does not mark today or future occurrences missed from a future dashboard read', async () => {
  const repository = new MemorySelfCareRepository()
  const context = createWriteContext()
  const today = getDateKey(new Date())
  const tomorrow = addDays(today, 1)
  const futureDate = addDays(today, 2)

  await repository.createItem({
    context,
    input: selfCareItemInputSchema.parse({
      category: 'movement',
      scheduleRule: {
        repeatKind: 'daily',
        startDate: today,
      },
      title: 'Йога',
      type: 'habit',
    }),
  })

  await repository.generateOccurrences({
    context,
    from: today,
    to: tomorrow,
  })
  await repository.getDashboard({
    context,
    date: futureDate,
  })
  const occurrences = await repository.getOccurrences({
    context,
    from: today,
    to: tomorrow,
  })

  assert.deepEqual(
    occurrences.map((occurrence) => [
      occurrence.scheduledFor,
      occurrence.status,
    ]),
    [
      [today, 'scheduled'],
      [tomorrow, 'scheduled'],
    ],
  )
})

void test('MemorySelfCareRepository keeps existing occurrences when schedule rule is updated', async () => {
  const repository = new MemorySelfCareRepository()
  const context = createWriteContext()
  const item = await repository.createItem({
    context,
    input: selfCareItemInputSchema.parse({
      category: 'movement',
      preferredTimeOfDay: 'morning',
      scheduleRule: {
        repeatKind: 'daily',
        startDate: '2026-06-10',
      },
      title: 'Йога',
      type: 'habit',
    }),
  })

  await repository.generateOccurrences({
    context,
    from: '2026-06-10',
    to: '2026-06-10',
  })
  const initialPlan = await repository.getPlan({
    context,
    from: '2026-06-10',
    to: '2026-06-10',
  })
  const initialOccurrence = initialPlan.occurrences[0]?.occurrence

  assert.ok(initialOccurrence)

  const updated = await repository.updateItem({
    context,
    input: selfCareItemUpdateInputSchema.parse({
      expectedVersion: item.version,
      preferredTimeOfDay: 'afternoon',
      scheduleRule: {
        repeatKind: 'daily',
        startDate: '2026-06-10',
      },
    }),
    itemId: item.id,
  })

  await repository.generateOccurrences({
    context,
    from: '2026-06-10',
    to: '2026-06-10',
  })
  const plan = await repository.getPlan({
    context,
    from: '2026-06-10',
    to: '2026-06-10',
  })
  const occurrences = plan.occurrences.filter(
    (entry) => entry.item.id === item.id,
  )

  assert.equal(updated.preferredTimeOfDay, 'afternoon')
  assert.equal(occurrences.length, 1)
  assert.equal(occurrences[0]?.occurrence?.id, initialOccurrence.id)
  assert.equal(
    occurrences[0]?.occurrence?.scheduleRuleId,
    initialOccurrence.scheduleRuleId,
  )
})

void test('MemorySelfCareRepository keeps carry-over procedures scheduled overdue', async () => {
  const repository = new MemorySelfCareRepository()
  const context = createWriteContext()
  const item = await repository.createItem({
    context,
    input: selfCareItemInputSchema.parse({
      category: 'beauty',
      scheduleRule: {
        intervalUnit: 'week',
        intervalValue: 4,
        repeatKind: 'after_completion',
        startDate: '2026-06-08',
      },
      title: 'Стрижка',
      type: 'procedure',
    }),
  })
  const occurrence = await repository.scheduleItem({
    context,
    input: selfCareItemScheduleInputSchema.parse({
      scheduledFor: '2026-06-08',
    }),
    itemId: item.id,
  })

  const dashboard = await repository.getDashboard({
    context,
    date: '2026-06-09',
  })
  const occurrences = await repository.getOccurrences({
    context,
    from: '2026-06-08',
    to: '2026-06-08',
  })

  assert.equal(occurrences[0]?.status, 'scheduled')
  assert.deepEqual(
    dashboard.overdueItems.map((entry) => entry.occurrence?.id),
    [occurrence.id],
  )
})

void test('MemorySelfCareRepository deduplicates ad-hoc item completion per day', async () => {
  const repository = new MemorySelfCareRepository()
  const context = createWriteContext()
  const item = await repository.createItem({
    context,
    input: selfCareItemInputSchema.parse({
      category: 'medical',
      scheduleRule: {
        intervalUnit: 'month',
        intervalValue: 6,
        repeatKind: 'after_completion',
        startDate: '2026-06-08',
      },
      title: 'Стоматолог',
      type: 'medical',
    }),
  })
  const input = selfCareRitualCompletionInputSchema.parse({
    completedAt: '2026-06-10T12:00:00.000Z',
    status: 'done',
  })

  const first = await repository.completeItemNow({
    context,
    input,
    itemId: item.id,
  })
  const second = await repository.completeItemNow({
    context,
    input,
    itemId: item.id,
  })
  const history = await repository.getHistory(
    context,
    '2026-06-10',
    '2026-06-10',
  )

  assert.equal(second.id, first.id)
  assert.equal(history.completions.length, 1)
})

void test('MemorySelfCareRepository versions gentle-mode changes like Postgres', async () => {
  const repository = new MemorySelfCareRepository()
  const context = createWriteContext()
  const defaults = await repository.getSettings(context)

  const enabled = await repository.enableGentleMode({
    context,
    date: '2026-08-06',
  })
  const disabled = await repository.disableGentleMode({
    context,
    date: '2026-08-06',
  })

  assert.equal(enabled.settings.version, defaults.settings.version + 1)
  assert.equal(disabled.settings.version, enabled.settings.version + 1)
})

void test('MemorySelfCareRepository consumes one item version and clears the draft for an accepted deduplicated completion command', async () => {
  const repository = new MemorySelfCareRepository()
  const context = createWriteContext()
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

  const input = {
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
        input,
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

  const second = await repository.executeOfflineCommand({
    context,
    request: selfCareOfflineCommandRequestSchema.parse({
      clientTimeZone: 'UTC',
      command: {
        completionId: generateUuidV7(),
        expectedVersion: first.result.item.version,
        input,
        itemId: item.id,
        type: 'complete_item_now',
      },
      operationId: generateUuidV7(),
    }),
  })
  assert.equal(second.result.kind, 'completion')
  assert.ok(second.result.kind === 'completion' && second.result.item)
  assert.equal(second.result.completion.id, first.result.completion.id)
  assert.equal(second.result.item.version, first.result.item.version + 1)
  assert.deepEqual(
    (
      await repository.getRitualStepDrafts({
        context,
        date: '2026-08-06',
      })
    ).drafts,
    [],
  )

  await assert.rejects(
    repository.executeOfflineCommand({
      context,
      request: selfCareOfflineCommandRequestSchema.parse({
        clientTimeZone: 'UTC',
        command: {
          completionId: generateUuidV7(),
          expectedVersion: first.result.item.version,
          input,
          itemId: item.id,
          type: 'complete_item_now',
        },
        operationId: generateUuidV7(),
      }),
    }),
    (error: unknown) =>
      error instanceof HttpError &&
      error.statusCode === 409 &&
      error.code === 'self_care_version_conflict',
  )

  const updated = await repository.executeOfflineCommand({
    context,
    request: selfCareOfflineCommandRequestSchema.parse({
      command: {
        expectedVersion: second.result.item.version,
        input: { title: 'Утренний ритуал — обновлён' },
        itemId: item.id,
        type: 'update_item',
      },
      operationId: generateUuidV7(),
    }),
  })
  assert.equal(updated.result.kind, 'item')
  assert.equal(updated.result.item.version, second.result.item.version + 1)
})

void test('MemorySelfCareRepository allows repeated completions for migrated flexible habits', async () => {
  const repository = new MemorySelfCareRepository()
  const context = createWriteContext()
  const item = await repository.createItem({
    context,
    input: selfCareItemInputSchema.parse({
      category: 'daily_base',
      migratedFromHabitId: 'legacy-habit-1',
      scheduleRule: {
        flexiblePeriod: 'day',
        flexibleTargetCount: 3,
        repeatKind: 'flexible_goal',
        startDate: '2026-06-10',
      },
      title: 'Вода',
      type: 'habit',
    }),
  })
  const input = selfCareRitualCompletionInputSchema.parse({
    completedAt: '2026-06-10T12:00:00.000Z',
    status: 'done',
  })

  const first = await repository.completeItemNow({
    context,
    input,
    itemId: item.id,
  })
  const second = await repository.completeItemNow({
    context,
    input,
    itemId: item.id,
  })
  const history = await repository.getHistory(
    context,
    '2026-06-10',
    '2026-06-10',
  )
  const dashboard = await repository.getDashboard({
    context,
    date: '2026-06-10',
  })

  assert.notEqual(second.id, first.id)
  assert.equal(history.completions.length, 2)
  assert.equal(dashboard.flexibleGoals[0]?.flexibleProgress?.completedCount, 2)
  assert.equal(dashboard.flexibleGoals[0]?.flexibleProgress?.targetCount, 3)
})

void test('MemorySelfCareRepository repeats flexible goals with standard repeat rules', async () => {
  const repository = new MemorySelfCareRepository()
  const context = createWriteContext()
  const item = await repository.createItem({
    context,
    input: selfCareItemInputSchema.parse({
      category: 'medical',
      scheduleRule: {
        flexiblePeriod: 'day',
        flexibleTargetCount: 1,
        intervalValue: 3,
        repeatKind: 'daily',
        startDate: '2026-06-01',
      },
      title: 'Таблетка',
      type: 'flexible_goal',
    }),
  })

  const activeDashboard = await repository.getDashboard({
    context,
    date: '2026-06-04',
  })
  const inactiveDashboard = await repository.getDashboard({
    context,
    date: '2026-06-05',
  })

  assert.deepEqual(
    activeDashboard.flexibleGoals.map((entry) => entry.item.id),
    [item.id],
  )
  assert.deepEqual(inactiveDashboard.flexibleGoals, [])
})

void test('MemorySelfCareRepository deactivates one-off flexible goals after target completion', async () => {
  const repository = new MemorySelfCareRepository()
  const context = createWriteContext()
  const item = await repository.createItem({
    context,
    input: selfCareItemInputSchema.parse({
      category: 'movement',
      scheduleRule: {
        flexiblePeriod: 'week',
        flexibleTargetCount: 2,
        repeatKind: 'none',
        startDate: '2026-06-01',
      },
      title: 'Две прогулки',
      type: 'flexible_goal',
    }),
  })

  await repository.completeFlexibleGoal({
    context,
    input: selfCareCompletionInputSchema.parse({
      completedAt: '2026-06-02T12:00:00.000Z',
      status: 'done',
    }),
    itemId: item.id,
  })
  const inProgressDashboard = await repository.getDashboard({
    context,
    date: '2026-06-03',
  })

  await repository.completeFlexibleGoal({
    context,
    input: selfCareCompletionInputSchema.parse({
      completedAt: '2026-06-03T12:00:00.000Z',
      status: 'done',
    }),
    itemId: item.id,
  })
  const list = await repository.listItems(context)
  const completedDashboard = await repository.getDashboard({
    context,
    date: '2026-06-04',
  })
  const updatedItem = list.items.find((candidate) => candidate.id === item.id)

  assert.equal(inProgressDashboard.flexibleGoals[0]?.item.id, item.id)
  assert.equal(
    inProgressDashboard.flexibleGoals[0]?.flexibleProgress?.completedCount,
    1,
  )
  assert.equal(updatedItem?.isActive, false)
  assert.deepEqual(completedDashboard.flexibleGoals, [])
})

void test('MemorySelfCareRepository restarts repeating courses after the configured break', async () => {
  const repository = new MemorySelfCareRepository()
  const context = createWriteContext()
  const item = await repository.createItem({
    context,
    input: selfCareItemInputSchema.parse({
      category: 'medical',
      courseDetails: {
        breakDays: 7,
        courseType: 'days',
        endDate: null,
        repeatAfterCompletion: true,
        startDate: '2026-06-01',
        totalCount: 2,
      },
      scheduleRule: {
        repeatKind: 'course',
        startDate: '2026-06-01',
      },
      title: 'Курс таблеток',
      type: 'course',
    }),
  })

  await repository.completeCourseSession({
    context,
    input: selfCareCompletionInputSchema.parse({
      completedAt: '2026-06-01T12:00:00.000Z',
      status: 'done',
    }),
    itemId: item.id,
  })
  await repository.completeCourseSession({
    context,
    input: selfCareCompletionInputSchema.parse({
      completedAt: '2026-06-02T12:00:00.000Z',
      status: 'done',
    }),
    itemId: item.id,
  })
  const list = await repository.listItems(context)
  const course = list.courseDetails.find(
    (details) => details.itemId === item.id,
  )
  const scheduleRule = list.scheduleRules.find(
    (rule) => rule.itemId === item.id,
  )

  assert.equal(course?.completedCount, 0)
  assert.equal(course?.isCompleted, false)
  assert.equal(course?.repeatAfterCompletion, true)
  assert.equal(course?.breakDays, 7)
  assert.equal(course?.startDate, '2026-06-10')
  assert.equal(scheduleRule?.startDate, '2026-06-10')
})

void test('MemorySelfCareRepository stores ad-hoc ritual step completion', async () => {
  const repository = new MemorySelfCareRepository()
  const context = createWriteContext()
  const item = await repository.createItem({
    context,
    input: selfCareItemInputSchema.parse({
      category: 'daily_base',
      scheduleRule: {
        repeatKind: 'daily',
        startDate: '2026-06-10',
      },
      steps: [
        {
          defaultChecked: false,
          isOptional: false,
          order: 0,
          title: 'Умыться',
        },
        {
          defaultChecked: false,
          isOptional: false,
          order: 1,
          title: 'SPF',
        },
      ],
      title: 'Утренний минимум',
      type: 'ritual',
    }),
  })
  const list = await repository.listItems(context)
  const steps = list.steps.filter((step) => step.itemId === item.id)
  const firstStep = steps[0]
  const secondStep = steps[1]
  assert.ok(firstStep)
  assert.ok(secondStep)
  const completion = await repository.completeItemNow({
    context,
    input: selfCareRitualCompletionInputSchema.parse({
      completedAt: '2026-06-10T12:00:00.000Z',
      status: 'done',
      steps: [
        {
          isDone: true,
          stepId: firstStep.id,
        },
        {
          isDone: false,
          stepId: secondStep.id,
        },
      ],
    }),
    itemId: item.id,
  })
  const history = await repository.getHistory(
    context,
    '2026-06-10',
    '2026-06-10',
  )

  assert.equal(completion.status, 'partial')
  assert.equal(history.stepCompletions.length, 2)
  const stepDoneById = new Map(
    history.stepCompletions.map((step) => [step.stepId, step.isDone]),
  )
  assert.equal(stepDoneById.get(firstStep.id), true)
  assert.equal(stepDoneById.get(secondStep.id), false)
})

void test('MemorySelfCareRepository rejects a ritual completion step from another item without partial writes', async () => {
  const repository = new MemorySelfCareRepository()
  const context = createWriteContext()
  const source = await repository.createItem({
    context,
    input: selfCareItemInputSchema.parse({
      category: 'daily_base',
      steps: [{ title: 'Шаг источника' }],
      title: 'Первый ритуал',
      type: 'ritual',
    }),
  })
  const target = await repository.createItem({
    context,
    input: selfCareItemInputSchema.parse({
      category: 'daily_base',
      steps: [{ title: 'Шаг цели' }],
      title: 'Второй ритуал',
      type: 'ritual',
    }),
  })
  const list = await repository.listItems(context)
  const sourceStep = list.steps.find((step) => step.itemId === source.id)
  const targetStep = list.steps.find((step) => step.itemId === target.id)
  assert.ok(sourceStep)
  assert.ok(targetStep)

  await repository.upsertRitualStepDraft({
    context,
    expectedVersion: null,
    input: selfCareRitualStepDraftInputSchema.parse({
      date: '2026-08-06',
      itemId: target.id,
      occurrenceId: null,
      stepIds: [targetStep.id],
    }),
  })

  await assert.rejects(
    repository.completeItemNow({
      context,
      expectedVersion: target.version,
      input: selfCareRitualCompletionInputSchema.parse({
        completedAt: '2026-08-06T08:00:00.000Z',
        status: 'done',
        steps: [{ isDone: true, stepId: sourceStep.id }],
      }),
      itemId: target.id,
    }),
    (error: unknown) =>
      error instanceof HttpError &&
      error.statusCode === 409 &&
      error.code === 'self_care_ritual_step_conflict',
  )
  await assert.rejects(
    repository.completeItemNow({
      context,
      expectedVersion: target.version,
      input: selfCareRitualCompletionInputSchema.parse({
        completedAt: '2026-08-06T08:00:00.000Z',
        status: 'done',
        steps: [
          { isDone: true, stepId: targetStep.id },
          { isDone: false, stepId: targetStep.id },
        ],
      }),
      itemId: target.id,
    }),
    (error: unknown) =>
      error instanceof HttpError &&
      error.statusCode === 400 &&
      error.code === 'self_care_ritual_completion_invalid_step',
  )

  const after = await repository.listItems(context)
  assert.equal(
    after.items.find((item) => item.id === target.id)?.version,
    target.version,
  )
  assert.equal(
    (await repository.getHistory(context, '2026-08-06', '2026-08-06'))
      .completions.length,
    0,
  )
  assert.deepEqual(
    (
      await repository.getRitualStepDrafts({
        context,
        date: '2026-08-06',
      })
    ).drafts[0]?.stepIds,
    [targetStep.id],
  )
})

void test('MemorySelfCareRepository rejects a guessed cross-user ritual step before changing an occurrence or course', async () => {
  const repository = new MemorySelfCareRepository()
  const firstContext = createWriteContext()
  const secondContext = createWriteContext()
  const source = await repository.createItem({
    context: firstContext,
    input: selfCareItemInputSchema.parse({
      category: 'daily_base',
      steps: [{ title: 'Чужой шаг' }],
      title: 'Чужой ритуал',
      type: 'ritual',
    }),
  })
  const sourceStep = (await repository.listItems(firstContext)).steps.find(
    (step) => step.itemId === source.id,
  )
  assert.ok(sourceStep)
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
    repository.completeOccurrence({
      context: secondContext,
      expectedVersion: occurrence.version,
      input: selfCareRitualCompletionInputSchema.parse({
        completedAt: '2026-08-06T09:00:00.000Z',
        status: 'done',
        steps: [{ isDone: true, stepId: sourceStep.id }],
      }),
      occurrenceId: occurrence.id,
    }),
    (error: unknown) =>
      error instanceof HttpError &&
      error.statusCode === 409 &&
      error.code === 'self_care_ritual_step_conflict',
  )

  const occurrenceAfter = (
    await repository.getOccurrences({
      context: secondContext,
      from: '2026-08-06',
      to: '2026-08-06',
    })
  ).find((candidate) => candidate.id === occurrence.id)
  const courseAfter = (
    await repository.listItems(secondContext)
  ).courseDetails.find((course) => course.itemId === courseItem.id)
  const history = await repository.getHistory(
    secondContext,
    '2026-08-06',
    '2026-08-06',
  )

  assert.equal(occurrenceAfter?.status, 'scheduled')
  assert.equal(occurrenceAfter?.version, occurrence.version)
  assert.deepEqual(courseAfter, courseBefore)
  assert.deepEqual(history.completions, [])
  assert.deepEqual(history.stepCompletions, [])
})

void test('MemorySelfCareRepository stores measurement details and reading', async () => {
  const repository = new MemorySelfCareRepository()
  const context = createWriteContext()
  const item = await repository.createItem({
    context,
    input: selfCareItemInputSchema.parse({
      category: 'body',
      measurementDetails: {
        targetMax: 82,
        targetMin: 78,
        unit: 'кг',
        valueLabel: 'Вес',
      },
      scheduleRule: {
        repeatKind: 'daily',
        startDate: '2026-06-10',
      },
      title: 'Вес',
      type: 'measurement',
    }),
  })

  await assert.rejects(
    () =>
      repository.completeItemNow({
        context,
        input: selfCareRitualCompletionInputSchema.parse({
          completedAt: '2026-06-10T12:00:00.000Z',
          status: 'done',
        }),
        itemId: item.id,
      }),
    /Measurement value is required/u,
  )

  const completion = await repository.completeItemNow({
    context,
    input: selfCareRitualCompletionInputSchema.parse({
      completedAt: '2026-06-10T12:00:00.000Z',
      measurementUnit: 'кг',
      measurementValue: 80.4,
      status: 'done',
    }),
    itemId: item.id,
  })
  const list = await repository.listItems(context)
  const history = await repository.getHistory(
    context,
    '2026-06-10',
    '2026-06-10',
  )

  assert.equal(completion.measurementValue, 80.4)
  assert.equal(completion.measurementUnit, 'кг')
  assert.equal(list.measurementDetails[0]?.itemId, item.id)
  assert.equal(list.measurementDetails[0]?.targetMin, 78)
  assert.equal(history.completions[0]?.measurementValue, 80.4)
})

void test('MemorySelfCareRepository updates completed procedure cost for history and analytics', async () => {
  const repository = new MemorySelfCareRepository()
  const context = createWriteContext()
  const item = await repository.createItem({
    context,
    input: selfCareItemInputSchema.parse({
      category: 'beauty',
      procedureDetails: {
        currency: 'RUB',
        defaultPrice: 2500,
      },
      title: 'Кератин',
      type: 'procedure',
    }),
  })
  const completion = await repository.completeItemNow({
    context,
    input: selfCareRitualCompletionInputSchema.parse({
      completedAt: '2026-06-10T12:00:00.000Z',
      status: 'done',
    }),
    itemId: item.id,
  })

  const updated = await repository.updateCompletion({
    completionId: completion.id,
    context,
    input: selfCareCompletionUpdateInputSchema.parse({
      currency: 'RUB',
      note: 'Фактическая стоимость',
      price: 3200,
    }),
  })
  const history = await repository.getHistory(
    context,
    '2026-06-10',
    '2026-06-10',
  )
  const analytics = await repository.getAnalytics(
    context,
    '2026-06-01',
    '2026-06-30',
  )

  assert.equal(updated.price, 3200)
  assert.equal(updated.currency, 'RUB')
  assert.equal(history.completions[0]?.price, 3200)
  assert.equal(history.completions[0]?.note, 'Фактическая стоимость')
  assert.equal(analytics.procedureCosts, 3200)
  assert.deepEqual(analytics.procedureCostsByMonth, { '2026-06': 3200 })
})

void test('MemorySelfCareRepository stores exercise details, sets, and trend', async () => {
  const repository = new MemorySelfCareRepository()
  const context = createWriteContext()
  const item = await repository.createItem({
    context,
    input: selfCareItemInputSchema.parse({
      category: 'movement',
      exerciseDetails: {
        metricType: 'count',
        plannedSets: 3,
        plannedValue: 20,
        unit: 'reps',
        useSets: true,
      },
      scheduleRule: {
        repeatKind: 'daily',
        startDate: '2026-06-10',
      },
      title: 'Приседания',
      type: 'exercise',
    }),
  })

  await assert.rejects(
    () =>
      repository.completeItemNow({
        context,
        input: selfCareRitualCompletionInputSchema.parse({
          completedAt: '2026-06-10T12:00:00.000Z',
          status: 'done',
        }),
        itemId: item.id,
      }),
    /Exercise value is required/u,
  )

  const completion = await repository.completeItemNow({
    context,
    input: selfCareRitualCompletionInputSchema.parse({
      completedAt: '2026-06-10T12:00:00.000Z',
      exerciseSets: [
        { index: 1, value: 10 },
        { index: 2, value: 10 },
        { index: 3, value: 8 },
      ],
      measurementUnit: 'reps',
      measurementValue: 28,
      status: 'done',
    }),
    itemId: item.id,
  })
  const list = await repository.listItems(context)
  const analytics = await repository.getAnalytics(
    context,
    '2026-06-10',
    '2026-06-10',
  )

  assert.equal(completion.measurementValue, 28)
  assert.deepEqual(completion.exerciseSets, [
    { index: 1, value: 10 },
    { index: 2, value: 10 },
    { index: 3, value: 8 },
  ])
  assert.equal(list.exerciseDetails[0]?.itemId, item.id)
  assert.equal(list.exerciseDetails[0]?.metricType, 'count')
  assert.equal(analytics.exerciseTrends[0]?.itemId, item.id)
  assert.equal(analytics.exerciseTrends[0]?.points[0]?.value, 28)
})

void test('MemorySelfCareRepository updates exercise progress instead of appending same-day points', async () => {
  const repository = new MemorySelfCareRepository()
  const context = createWriteContext()
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
  const final = await repository.completeItemNow({
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
    itemId: item.id,
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

  assert.equal(second.id, first.id)
  assert.equal(final.id, first.id)
  assert.equal(first.version, 1)
  assert.equal(second.version, 2)
  assert.equal(final.version, 3)
  assert.equal(second.createdAt, first.createdAt)
  assert.equal(final.createdAt, first.createdAt)
  assert.notEqual(second.updatedAt, second.completedAt)
  assert.notEqual(final.updatedAt, final.completedAt)
  assert.equal(history.completions.length, 1)
  assert.equal(history.completions[0]?.status, 'done')
  assert.equal(history.completions[0]?.measurementValue, 28)
  assert.deepEqual(history.completions[0]?.exerciseSets, [
    { index: 1, value: 8 },
    { index: 2, value: 10 },
    { index: 3, value: 10 },
  ])
  assert.equal(analytics.exerciseTrends[0]?.points.length, 1)
  assert.equal(analytics.exerciseTrends[0]?.points[0]?.value, 28)
})

void test('MemorySelfCareRepository stores mood check state values', async () => {
  const repository = new MemorySelfCareRepository()
  const context = createWriteContext()
  const item = await repository.createItem({
    context,
    input: selfCareItemInputSchema.parse({
      category: 'emotional',
      scheduleRule: {
        repeatKind: 'daily',
        startDate: '2026-06-10',
      },
      title: 'Дневник состояния',
      type: 'mood_check',
    }),
  })

  await assert.rejects(
    () =>
      repository.completeItemNow({
        context,
        input: selfCareRitualCompletionInputSchema.parse({
          completedAt: '2026-06-10T12:00:00.000Z',
          status: 'done',
        }),
        itemId: item.id,
      }),
    /Mood or energy value is required/u,
  )

  const completion = await repository.completeItemNow({
    context,
    input: selfCareRitualCompletionInputSchema.parse({
      completedAt: '2026-06-10T12:00:00.000Z',
      energyAfter: 3,
      moodAfter: 4,
      note: 'Спокойный день.',
      status: 'done',
    }),
    itemId: item.id,
  })
  const history = await repository.getHistory(
    context,
    '2026-06-10',
    '2026-06-10',
  )

  assert.equal(completion.moodAfter, 4)
  assert.equal(completion.energyAfter, 3)
  assert.equal(history.completions[0]?.moodAfter, 4)
  assert.equal(history.completions[0]?.energyAfter, 3)
})

void test('MemorySelfCareRepository persists ritual step drafts until completion', async () => {
  const repository = new MemorySelfCareRepository()
  const context = createWriteContext()
  const item = await repository.createItem({
    context,
    input: selfCareItemInputSchema.parse({
      category: 'relax',
      scheduleRule: {
        repeatKind: 'daily',
        startDate: '2026-06-10',
      },
      steps: [
        { defaultChecked: true, title: 'Подготовить место' },
        { title: 'Сделать практику' },
      ],
      title: 'Вечерний ритуал',
      type: 'ritual',
    }),
  })

  await repository.generateOccurrences({
    context,
    from: '2026-06-10',
    to: '2026-06-10',
  })
  const plan = await repository.getPlan({
    context,
    from: '2026-06-10',
    to: '2026-06-10',
  })
  const occurrence = plan.occurrences.find(
    (entry) => entry.item.id === item.id,
  )?.occurrence
  const steps = (await repository.listItems(context)).steps.filter(
    (step) => step.itemId === item.id,
  )

  assert.ok(occurrence)
  assert.equal(steps.length, 2)
  const secondStep = steps[1]
  assert.ok(secondStep)

  await repository.upsertRitualStepDraft({
    context,
    input: selfCareRitualStepDraftInputSchema.parse({
      date: '2026-06-10',
      itemId: item.id,
      occurrenceId: occurrence.id,
      stepIds: [secondStep.id],
    }),
  })

  let drafts = await repository.getRitualStepDrafts({
    context,
    date: '2026-06-10',
  })

  assert.deepEqual(drafts.drafts[0]?.stepIds, [secondStep.id])

  await repository.upsertRitualStepDraft({
    context,
    input: selfCareRitualStepDraftInputSchema.parse({
      date: '2026-06-10',
      itemId: item.id,
      occurrenceId: occurrence.id,
      stepIds: [],
    }),
  })

  drafts = await repository.getRitualStepDrafts({
    context,
    date: '2026-06-10',
  })

  assert.deepEqual(drafts.drafts[0]?.stepIds, [])

  await repository.completeOccurrence({
    context,
    input: selfCareRitualCompletionInputSchema.parse({
      completedAt: '2026-06-10T12:00:00.000Z',
      status: 'done',
      steps: steps.map((step) => ({ isDone: false, stepId: step.id })),
    }),
    occurrenceId: occurrence.id,
  })

  drafts = await repository.getRitualStepDrafts({
    context,
    date: '2026-06-10',
  })

  assert.deepEqual(drafts.drafts, [])
})

void test('MemorySelfCareRepository replays an offline command once and rejects operation id reuse', async () => {
  const repository = new MemorySelfCareRepository()
  const context = createWriteContext()
  const createdItemId = '0198f4c0-7340-7a20-aadf-09db0ee49201'
  const request = selfCareOfflineCommandRequestSchema.parse({
    command: {
      initialSchedule: {
        input: { scheduledFor: '2026-08-06' },
        occurrenceId: '0198f4c0-7340-7a20-aadf-09db0ee49202',
      },
      input: {
        category: 'relax',
        id: createdItemId,
        title: 'Тихая пауза',
        type: 'rest_action',
      },
      type: 'create_item',
    },
    operationId: '0198f4c0-7340-7a20-aadf-09db0ee49200',
  })

  const first = await repository.executeOfflineCommand({ context, request })
  const replay = await repository.executeOfflineCommand({ context, request })
  const state = await repository.listItems(context)
  const occurrences = await repository.getOccurrences({
    context,
    from: '2026-08-06',
    to: '2026-08-06',
  })

  assert.equal(first.replayed, false)
  assert.equal(replay.replayed, true)
  assert.deepEqual(replay.result, first.result)
  assert.equal(
    state.items.filter((item) => item.id === createdItemId).length,
    1,
  )
  assert.equal(occurrences.length, 1)

  const reused = selfCareOfflineCommandRequestSchema.parse({
    ...request,
    command: {
      initialSchedule: {
        input: { scheduledFor: '2026-08-06' },
        occurrenceId: '0198f4c0-7340-7a20-aadf-09db0ee49202',
      },
      input: {
        category: 'relax',
        id: createdItemId,
        title: 'Другая пауза',
        type: 'rest_action',
      },
      type: 'create_item',
    },
  })
  await assert.rejects(
    repository.executeOfflineCommand({ context, request: reused }),
    (error: unknown) =>
      error instanceof HttpError &&
      error.statusCode === 409 &&
      error.code === 'self_care_operation_id_reused',
  )
})

void test('MemorySelfCareRepository returns both occurrences from an atomic item update and reschedule', async () => {
  const repository = new MemorySelfCareRepository()
  const context = createWriteContext()
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
    }),
    itemId: item.id,
  })
  const replacementOccurrenceId = '0198f4c0-7340-7a20-aadf-09db0ee49212'
  const request = selfCareOfflineCommandRequestSchema.parse({
    command: {
      expectedVersion: item.version,
      input: { description: 'После изменения' },
      itemId: item.id,
      scheduleChange: {
        actedAt: '2026-08-06T09:00:00.000Z',
        completionId: '0198f4c0-7340-7a20-aadf-09db0ee49211',
        expectedVersion: occurrence.version,
        input: { newDate: '2026-08-07' },
        occurrenceId: occurrence.id,
        replacementInput: { scheduledFor: '2026-08-07' },
        replacementOccurrenceId,
        type: 'reschedule',
      },
      type: 'update_item',
    },
    operationId: '0198f4c0-7340-7a20-aadf-09db0ee49210',
  })

  const response = await repository.executeOfflineCommand({
    context,
    request,
  })

  assert.equal(response.result.kind, 'item')
  if (response.result.kind !== 'item') return
  assert.equal(response.result.item.description, 'После изменения')
  assert.equal(response.result.occurrence?.id, occurrence.id)
  assert.equal(response.result.occurrence?.status, 'moved')
  assert.equal(response.result.occurrence?.movedTo, '2026-08-07')
  assert.equal(response.result.replacement?.id, replacementOccurrenceId)
  assert.equal(response.result.replacement?.status, 'scheduled')
  assert.equal(response.result.replacement?.scheduledFor, '2026-08-07')
})

void test('MemorySelfCareRepository atomically updates an item and same-date schedule details without move history', async () => {
  const repository = new MemorySelfCareRepository()
  const context = createWriteContext()
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

  const response = await repository.executeOfflineCommand({ context, request })

  assert.equal(response.result.kind, 'item')
  assert.ok(response.result.kind === 'item' && response.result.occurrence)
  assert.equal(response.result.item.description, 'После изменения')
  assert.equal(response.result.item.version, item.version + 1)
  assert.equal(response.result.occurrence.id, occurrence.id)
  assert.equal(response.result.occurrence.version, occurrence.version + 1)
  assert.equal(response.result.occurrence.status, 'scheduled')
  assert.equal(response.result.occurrence.movedTo, null)
  assert.equal(response.result.replacement, undefined)
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
    isConflict('self_care_version_conflict'),
  )
  const afterRejected = await repository.listItems(context)
  assert.equal(
    afterRejected.items.find((candidate) => candidate.id === item.id)
      ?.description,
    'После изменения',
  )
  assert.equal(
    afterRejected.items.find((candidate) => candidate.id === item.id)?.version,
    item.version + 1,
  )
})

void test('MemorySelfCareRepository returns authoritative course progress from an offline completion', async () => {
  const repository = new MemorySelfCareRepository()
  const context = createWriteContext()
  const item = await repository.createItem({
    context,
    input: selfCareItemInputSchema.parse({
      category: 'medical',
      courseDetails: {
        breakDays: 0,
        courseType: 'sessions',
        repeatAfterCompletion: false,
        startDate: '2026-08-06',
        totalCount: 2,
      },
      scheduleRule: {
        repeatKind: 'course',
        startDate: '2026-08-06',
      },
      title: 'Курс',
      type: 'course',
    }),
  })
  const request = selfCareOfflineCommandRequestSchema.parse({
    command: {
      completionId: '0198f4c0-7340-7a20-aadf-09db0ee49222',
      expectedVersion: item.version,
      input: {
        completedAt: '2026-08-06T12:00:00.000Z',
        status: 'done',
      },
      itemId: item.id,
      type: 'complete_course_session',
    },
    operationId: '0198f4c0-7340-7a20-aadf-09db0ee49221',
  })

  const response = await repository.executeOfflineCommand({
    context,
    request,
  })

  assert.equal(response.result.kind, 'completion')
  if (response.result.kind !== 'completion') return
  assert.equal(response.result.item?.version, item.version + 1)
  assert.equal(response.result.courseDetails?.completedCount, 1)
  assert.equal(response.result.courseDetails?.isCompleted, false)
  assert.equal(response.result.scheduleRule?.itemId, item.id)
})

void test('MemorySelfCareRepository rolls back a failed atomic create and does not reserve its operation id', async () => {
  const repository = new MemorySelfCareRepository()
  const context = createWriteContext()
  const createdItemId = '0198f4c0-7340-7a20-aadf-09db0ee49301'
  const existing = await repository.createItem({
    context,
    input: selfCareItemInputSchema.parse({
      category: 'health',
      title: 'Вода',
      type: 'task',
    }),
  })
  const collidingOccurrenceId = '0198f4c0-7340-7a20-aadf-09db0ee49302'
  await repository.scheduleItem({
    context,
    input: selfCareItemScheduleInputSchema.parse({
      scheduledFor: '2026-08-06',
    }),
    itemId: existing.id,
    occurrenceId: collidingOccurrenceId,
    strictInsert: true,
  })

  const failedRequest = selfCareOfflineCommandRequestSchema.parse({
    command: {
      initialSchedule: {
        input: { scheduledFor: '2026-08-07' },
        occurrenceId: collidingOccurrenceId,
      },
      input: {
        category: 'relax',
        id: createdItemId,
        title: 'Новая пауза',
        type: 'rest_action',
      },
      type: 'create_item',
    },
    operationId: '0198f4c0-7340-7a20-aadf-09db0ee49300',
  })

  await assert.rejects(
    repository.executeOfflineCommand({ context, request: failedRequest }),
    (error: unknown) => error instanceof HttpError && error.statusCode === 409,
  )
  assert.equal(
    (await repository.listItems(context)).items.some(
      (item) => item.id === createdItemId,
    ),
    false,
  )

  const retry = selfCareOfflineCommandRequestSchema.parse({
    command: {
      input: {
        category: 'relax',
        id: createdItemId,
        title: 'Новая пауза',
        type: 'rest_action',
      },
      type: 'create_item',
    },
    operationId: failedRequest.operationId,
  })
  const result = await repository.executeOfflineCommand({
    context,
    request: retry,
  })

  assert.equal(result.replayed, false)
  assert.equal(result.result.kind, 'item')
})

void test('MemorySelfCareRepository reports optimistic version conflicts and never resurrects a closed occurrence in strict mode', async () => {
  const repository = new MemorySelfCareRepository()
  const context = createWriteContext()
  const item = await repository.createItem({
    context,
    input: selfCareItemInputSchema.parse({
      category: 'relax',
      title: 'Дыхание',
      type: 'task',
    }),
  })
  const occurrence = await repository.scheduleItem({
    context,
    input: selfCareItemScheduleInputSchema.parse({
      scheduledFor: '2026-08-06',
    }),
    itemId: item.id,
  })

  await repository.completeOccurrence({
    completionId: '0198f4c0-7340-7a20-aadf-09db0ee49401',
    context,
    expectedVersion: occurrence.version,
    input: selfCareRitualCompletionInputSchema.parse({
      completedAt: '2026-08-06T10:00:00.000Z',
      status: 'done',
    }),
    occurrenceId: occurrence.id,
  })

  await assert.rejects(
    repository.scheduleItem({
      context,
      input: selfCareItemScheduleInputSchema.parse({
        scheduledFor: occurrence.scheduledFor,
      }),
      itemId: item.id,
      occurrenceId: '0198f4c0-7340-7a20-aadf-09db0ee49402',
      strictInsert: true,
    }),
    (error: unknown) =>
      error instanceof HttpError &&
      error.statusCode === 409 &&
      error.code === 'self_care_schedule_slot_conflict',
  )

  await assert.rejects(
    repository.completeOccurrence({
      completionId: '0198f4c0-7340-7a20-aadf-09db0ee49403',
      context,
      expectedVersion: occurrence.version,
      input: selfCareRitualCompletionInputSchema.parse({
        completedAt: '2026-08-06T11:00:00.000Z',
        status: 'done',
      }),
      occurrenceId: occurrence.id,
    }),
    (error: unknown) => {
      if (!(error instanceof HttpError)) return false
      assert.equal(error.statusCode, 409)
      assert.equal(error.code, 'self_care_version_conflict')
      assert.deepEqual(error.details, {
        actualVersion: occurrence.version + 1,
        entityId: occurrence.id,
        entityType: 'occurrence',
        expectedVersion: occurrence.version,
      })
      return true
    },
  )
})

void test('MemorySelfCareRepository rolls back a composite update when the occurrence belongs to another item', async () => {
  const repository = new MemorySelfCareRepository()
  const context = createWriteContext()
  const itemA = await repository.createItem({
    context,
    input: selfCareItemInputSchema.parse({
      category: 'relax',
      description: 'До изменения',
      title: 'Пауза A',
      type: 'rest_action',
    }),
  })
  const itemB = await repository.createItem({
    context,
    input: selfCareItemInputSchema.parse({
      category: 'relax',
      title: 'Пауза B',
      type: 'rest_action',
    }),
  })
  const occurrenceB = await repository.scheduleItem({
    context,
    input: selfCareItemScheduleInputSchema.parse({
      scheduledFor: '2026-08-06',
    }),
    itemId: itemB.id,
  })
  const request = selfCareOfflineCommandRequestSchema.parse({
    command: {
      expectedVersion: itemA.version,
      input: { description: 'Не должно сохраниться' },
      itemId: itemA.id,
      scheduleChange: {
        actedAt: '2026-08-06T09:00:00.000Z',
        completionId: '0198f4c0-7340-7a20-aadf-09db0ee49501',
        expectedVersion: occurrenceB.version,
        input: { newDate: '2026-08-07' },
        occurrenceId: occurrenceB.id,
        replacementInput: { scheduledFor: '2026-08-07' },
        replacementOccurrenceId: '0198f4c0-7340-7a20-aadf-09db0ee49502',
        type: 'reschedule',
      },
      type: 'update_item',
    },
    operationId: '0198f4c0-7340-7a20-aadf-09db0ee49500',
  })

  await assert.rejects(
    repository.executeOfflineCommand({ context, request }),
    (error: unknown) =>
      error instanceof HttpError &&
      error.statusCode === 409 &&
      error.code === 'self_care_reschedule_item_conflict',
  )

  const state = await repository.listItems(context)
  const storedA = state.items.find((item) => item.id === itemA.id)
  const storedOccurrenceB = (
    await repository.getOccurrences({
      context,
      from: '2026-08-06',
      to: '2026-08-07',
    })
  ).find((occurrence) => occurrence.id === occurrenceB.id)

  assert.equal(storedA?.description, 'До изменения')
  assert.equal(storedA?.version, itemA.version)
  assert.equal(storedOccurrenceB?.status, 'scheduled')
  assert.equal(storedOccurrenceB?.version, occurrenceB.version)
  assert.deepEqual(
    (await repository.getHistory(context, '2026-08-06', '2026-08-07'))
      .completions,
    [],
  )
})

void test('MemorySelfCareRepository keeps client item, occurrence, and completion ids isolated across users', async () => {
  const repository = new MemorySelfCareRepository()
  const firstContext = createWriteContext()
  const secondContext = createWriteContext()
  const sharedItemId = '0198f4c0-7340-7a20-aadf-09db0ee49601'
  const sharedOccurrenceId = '0198f4c0-7340-7a20-aadf-09db0ee49602'
  const sharedCompletionId = '0198f4c0-7340-7a20-aadf-09db0ee49603'
  const sharedStepId = '0198f4c0-7340-7a20-aadf-09db0ee49604'

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

  const collidingItemRequest = selfCareOfflineCommandRequestSchema.parse({
    command: {
      input: {
        category: 'relax',
        id: sharedItemId,
        title: 'Запись второго пользователя',
        type: 'rest_action',
      },
      type: 'create_item',
    },
    operationId: '0198f4c0-7340-7a20-aadf-09db0ee49610',
  })
  await assert.rejects(
    repository.executeOfflineCommand({
      context: secondContext,
      request: collidingItemRequest,
    }),
    isConflict('self_care_item_id_conflict'),
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
    input: selfCareItemScheduleInputSchema.parse({
      scheduledFor: '2026-08-06',
    }),
    itemId: firstItem.id,
    occurrenceId: sharedOccurrenceId,
    strictInsert: true,
  })

  const collidingOccurrenceRequest = selfCareOfflineCommandRequestSchema.parse({
    command: {
      expectedVersion: secondItem.version,
      input: { scheduledFor: '2026-08-07' },
      itemId: secondItem.id,
      occurrenceId: sharedOccurrenceId,
      type: 'schedule_item',
    },
    operationId: '0198f4c0-7340-7a20-aadf-09db0ee49611',
  })
  await assert.rejects(
    repository.executeOfflineCommand({
      context: secondContext,
      request: collidingOccurrenceRequest,
    }),
    isConflict('self_care_occurrence_id_conflict'),
  )

  const collidingStepRequest = selfCareOfflineCommandRequestSchema.parse({
    command: {
      expectedVersion: secondItem.version,
      input: {
        steps: [{ id: sharedStepId, title: 'Шаг второго пользователя' }],
      },
      itemId: secondItem.id,
      type: 'update_item',
    },
    operationId: '0198f4c0-7340-7a20-aadf-09db0ee49613',
  })
  await assert.rejects(
    repository.executeOfflineCommand({
      context: secondContext,
      request: collidingStepRequest,
    }),
    isConflict('self_care_item_id_conflict'),
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
  const collidingCompletionRequest = selfCareOfflineCommandRequestSchema.parse({
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
    operationId: '0198f4c0-7340-7a20-aadf-09db0ee49612',
  })
  await assert.rejects(
    repository.executeOfflineCommand({
      context: secondContext,
      request: collidingCompletionRequest,
    }),
    isConflict('self_care_completion_id_conflict'),
  )

  assert.equal((await repository.listItems(secondContext)).items.length, 1)
})

function isConflict(code: string) {
  return (error: unknown) =>
    error instanceof HttpError &&
    error.statusCode === 409 &&
    error.code === code
}

function createWriteContext(): SelfCareWriteContext {
  return {
    actorUserId: randomUUID(),
    auth: null,
    groupRole: null,
    role: 'owner',
    workspaceId: randomUUID(),
    workspaceKind: 'personal',
  }
}
