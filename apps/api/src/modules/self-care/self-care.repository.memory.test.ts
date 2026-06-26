import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import test from 'node:test'

import {
  selfCareCompletionInputSchema,
  selfCareItemInputSchema,
  selfCareItemScheduleInputSchema,
  selfCareItemUpdateInputSchema,
  selfCareOccurrenceSkipInputSchema,
  selfCareRitualCompletionInputSchema,
  selfCareRitualStepDraftInputSchema,
} from '@planner/contracts'

import type { SelfCareWriteContext } from './self-care.model.js'
import { MemorySelfCareRepository } from './self-care.repository.memory.js'
import { addDays, getDateKey } from './self-care.shared.js'

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
