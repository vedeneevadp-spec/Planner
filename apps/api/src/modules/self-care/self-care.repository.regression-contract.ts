import assert from 'node:assert/strict'

import {
  addDateDays,
  generateUuidV7,
  getDateKeyInTimeZone,
  getIsoWeekday,
  selfCareItemInputSchema,
  selfCareItemScheduleInputSchema,
  selfCareItemUpdateInputSchema,
  selfCareOccurrenceSkipInputSchema,
  selfCareOfflineCommandRequestSchema,
  selfCareRitualCompletionInputSchema,
  selfCareRitualStepDraftInputSchema,
} from '@planner/contracts'

import type { SelfCareWriteContext } from './self-care.model.js'
import type { SelfCareRepository } from './self-care.repository.js'

export async function assertRitualHistorySurvivesEditing(
  repository: SelfCareRepository,
  context: SelfCareWriteContext,
) {
  const today = getDateKeyInTimeZone(new Date(), 'UTC')
  const item = await repository.createItem({
    context,
    input: selfCareItemInputSchema.parse({
      category: 'daily_base',
      title: 'Original ritual',
      type: 'ritual',
      steps: [{ title: 'Wash' }, { title: 'Cream' }],
    }),
  })
  const steps = (await repository.listItems(context)).steps.filter(
    (step) => step.itemId === item.id,
  )
  const completion = await repository.completeItemNow({
    context,
    itemId: item.id,
    input: selfCareRitualCompletionInputSchema.parse({
      completedAt: `${today}T12:00:00.000Z`,
      status: 'done',
      steps: steps.map((step) => ({ stepId: step.id, isDone: true })),
    }),
  })
  await repository.updateItem({
    context,
    itemId: item.id,
    input: selfCareItemUpdateInputSchema.parse({
      title: 'Renamed ritual',
      steps: [{ id: steps[0]!.id, title: 'Renamed wash' }],
    }),
  })
  const history = await repository.getHistory(context, today, today)
  const historicalSteps = history.stepCompletions.filter(
    (step) => step.completionId === completion.id,
  )
  assert.deepEqual(
    historicalSteps
      .map((step) => [step.stepTitle, step.stepOrder, step.isDone])
      .sort(),
    [
      ['Cream', 1, true],
      ['Wash', 0, true],
    ],
  )
  assert.deepEqual(
    (await repository.listItems(context)).steps
      .filter((step) => step.itemId === item.id)
      .map((step) => step.title),
    ['Renamed wash'],
  )

  await repository.updateRitualSteps({ context, itemId: item.id, steps: [] })
  const afterRemoval = await repository.getHistory(context, today, today)
  assert.deepEqual(
    afterRemoval.stepCompletions.filter(
      (step) => step.completionId === completion.id,
    ),
    historicalSteps,
  )
  assert.equal(
    (await repository.listItems(context)).steps.filter(
      (step) => step.itemId === item.id,
    ).length,
    0,
  )

  const current = (await repository.listItems(context)).items.find(
    (candidate) => candidate.id === item.id,
  )!
  const request = selfCareOfflineCommandRequestSchema.parse({
    operationId: generateUuidV7(),
    command: {
      type: 'update_item',
      itemId: item.id,
      expectedVersion: current.version,
      input: { steps: [{ id: generateUuidV7(), title: 'New step' }] },
    },
  })
  await repository.executeOfflineCommand({ context, request })
  assert.equal(
    (await repository.executeOfflineCommand({ context, request })).replayed,
    true,
  )
  assert.deepEqual(
    (await repository.getHistory(context, today, today)).stepCompletions.filter(
      (step) => step.completionId === completion.id,
    ),
    historicalSteps,
  )
}

export async function assertAtomicRuleEditPreservesSingleSchedule(
  repository: SelfCareRepository,
  context: SelfCareWriteContext,
) {
  const today = getDateKeyInTimeZone(new Date(), 'UTC')
  const to = addDateDays(today, 13)
  const item = await repository.createItem({
    context,
    input: selfCareItemInputSchema.parse({
      category: 'daily_base',
      title: 'Ritual with progress',
      type: 'ritual',
      steps: [{ title: 'Wash' }],
      scheduleRule: {
        repeatKind: 'daily',
        startDate: today,
        preferredTime: '09:00',
        timezone: 'UTC',
      },
    }),
  })
  const initial = await repository.getOccurrences({ context, from: today, to })
  const source = initial.find(
    (entry) => entry.scheduledFor === addDateDays(today, 1),
  )!
  const inProgress = initial.find(
    (entry) => entry.scheduledFor === addDateDays(today, 2),
  )!
  const step = (await repository.listItems(context)).steps[0]!
  await repository.upsertRitualStepDraft({
    context,
    input: selfCareRitualStepDraftInputSchema.parse({
      itemId: item.id,
      occurrenceId: inProgress.id,
      date: inProgress.scheduledFor,
      stepIds: [step.id],
    }),
  })
  const request = selfCareOfflineCommandRequestSchema.parse({
    operationId: generateUuidV7(),
    command: {
      type: 'update_item',
      itemId: item.id,
      expectedVersion: item.version,
      input: {
        scheduleRule: {
          repeatKind: 'weekly',
          startDate: today,
          daysOfWeek: [getIsoWeekday(today)],
          preferredTime: '12:00',
          timezone: 'UTC',
        },
      },
      scheduleChange: {
        type: 'update_schedule',
        occurrenceId: source.id,
        expectedVersion: source.version,
        input: {
          scheduledFor: source.scheduledFor,
          scheduledTime: '17:00',
          timezone: 'UTC',
        },
      },
    },
  })
  await repository.executeOfflineCommand({ context, request })
  assert.equal(
    (await repository.executeOfflineCommand({ context, request })).replayed,
    true,
  )
  const actual = await repository.getOccurrences({ context, from: today, to })
  assert.equal(
    actual.find((entry) => entry.id === source.id)?.dueAt,
    `${source.scheduledFor}T17:00:00.000Z`,
  )
  assert.equal(
    actual.find((entry) => entry.id === source.id)?.generatedAt,
    null,
  )
  assert.deepEqual(
    actual.find((entry) => entry.id === inProgress.id),
    inProgress,
  )
  const drafts = await repository.getRitualStepDrafts({
    context,
    date: inProgress.scheduledFor,
  })
  assert.deepEqual(drafts.drafts[0]?.stepIds, [step.id])
  assert.equal(actual.length, 4)
}

export async function assertFutureScheduleReconciles(
  repository: SelfCareRepository,
  context: SelfCareWriteContext,
) {
  const today = getDateKeyInTimeZone(new Date(), 'UTC')
  const to = addDateDays(today, 13)
  const item = await repository.createItem({
    context,
    input: selfCareItemInputSchema.parse({
      category: 'movement',
      title: 'Repeating care',
      type: 'habit',
      scheduleRule: {
        repeatKind: 'daily',
        startDate: today,
        preferredTime: '09:00',
        timezone: 'UTC',
      },
    }),
  })
  const initial = await repository.getOccurrences({ context, from: today, to })
  assert.equal(initial.length, 14)
  const byDate = new Map(
    initial.map((occurrence) => [occurrence.scheduledFor, occurrence]),
  )
  const completed = byDate.get(today)!
  await repository.completeOccurrence({
    context,
    occurrenceId: completed.id,
    input: selfCareRitualCompletionInputSchema.parse({
      status: 'done',
      completedAt: `${today}T09:00:00.000Z`,
    }),
  })
  const manual = byDate.get(addDateDays(today, 1))!
  await repository.scheduleItem({
    context,
    itemId: item.id,
    existingOccurrenceId: manual.id,
    expectedOccurrenceVersion: manual.version,
    input: selfCareItemScheduleInputSchema.parse({
      scheduledFor: manual.scheduledFor,
      scheduledTime: '17:00',
      timezone: 'UTC',
    }),
  })
  const moved = byDate.get(addDateDays(today, 2))!
  const movedDate = addDateDays(today, 16)
  await repository.moveOccurrence({
    context,
    occurrenceId: moved.id,
    input: { newDate: movedDate, note: 'Manual move' },
  })
  const replacement = await repository.scheduleItem({
    context,
    itemId: item.id,
    input: selfCareItemScheduleInputSchema.parse({
      scheduledFor: movedDate,
      scheduledTime: '18:00',
      timezone: 'UTC',
    }),
  })
  const skipped = byDate.get(addDateDays(today, 3))!
  await repository.skipOccurrence({
    context,
    occurrenceId: skipped.id,
    input: selfCareOccurrenceSkipInputSchema.parse({ reason: 'Rest day' }),
  })
  const rule = {
    repeatKind: 'weekly',
    daysOfWeek: [getIsoWeekday(today)],
    startDate: today,
    preferredTime: '12:00',
    timezone: 'UTC',
  }
  await repository.updateItem({
    context,
    itemId: item.id,
    input: selfCareItemUpdateInputSchema.parse({ scheduleRule: rule }),
  })
  let actual = await repository.getOccurrences({
    context,
    from: today,
    to: movedDate,
  })
  const auto = actual.filter(
    (entry) => entry.generatedAt !== null && entry.status === 'scheduled',
  )
  assert.deepEqual(
    auto.map((entry) => [entry.scheduledFor, entry.dueAt]),
    [
      [addDateDays(today, 7), `${addDateDays(today, 7)}T12:00:00.000Z`],
      [addDateDays(today, 14), `${addDateDays(today, 14)}T12:00:00.000Z`],
    ],
  )
  for (const [id, status] of [
    [completed.id, 'done'],
    [moved.id, 'moved'],
    [skipped.id, 'skipped'],
  ]) {
    assert.equal(actual.find((entry) => entry.id === id)?.status, status)
  }
  assert.equal(
    actual.find((entry) => entry.id === manual.id)?.dueAt,
    `${manual.scheduledFor}T17:00:00.000Z`,
  )
  assert.equal(
    actual.find((entry) => entry.id === replacement.id)?.dueAt,
    `${movedDate}T18:00:00.000Z`,
  )

  await repository.updateItem({
    context,
    itemId: item.id,
    input: selfCareItemUpdateInputSchema.parse({
      scheduleRule: { ...rule, timezone: 'Asia/Novosibirsk' },
    }),
  })
  actual = await repository.getOccurrences({
    context,
    from: today,
    to: movedDate,
  })
  assert.equal(
    actual.find((entry) => entry.id === auto[0]!.id)?.dueAt,
    `${addDateDays(today, 7)}T05:00:00.000Z`,
  )
  assert.equal(
    actual.find((entry) => entry.id === manual.id)?.dueAt,
    `${manual.scheduledFor}T17:00:00.000Z`,
  )
  await repository.updateItem({
    context,
    itemId: item.id,
    input: selfCareItemUpdateInputSchema.parse({
      scheduleRule: { repeatKind: 'none' },
    }),
  })
  actual = await repository.getOccurrences({
    context,
    from: today,
    to: movedDate,
  })
  assert.equal(
    actual.some(
      (entry) => entry.generatedAt !== null && entry.status === 'scheduled',
    ),
    false,
  )
  assert.equal(actual.length, 5)
}

export async function assertCoursePauseReconcilesGeneratedSlots(
  repository: SelfCareRepository,
  context: SelfCareWriteContext,
) {
  const today = getDateKeyInTimeZone(new Date(), 'UTC')
  const to = addDateDays(today, 4)
  const courseDetails = { courseType: 'days', totalCount: 5, startDate: today }
  const item = await repository.createItem({
    context,
    input: selfCareItemInputSchema.parse({
      category: 'medical',
      title: 'Short course',
      type: 'course',
      courseDetails,
      scheduleRule: {
        repeatKind: 'course',
        startDate: today,
        endDate: to,
        preferredTime: '09:00',
        timezone: 'UTC',
      },
    }),
  })
  const initial = await repository.getOccurrences({ context, from: today, to })
  assert.equal(initial.length, 5)
  const manual = initial[1]!
  await repository.scheduleItem({
    context,
    itemId: item.id,
    existingOccurrenceId: manual.id,
    expectedOccurrenceVersion: manual.version,
    input: selfCareItemScheduleInputSchema.parse({
      scheduledFor: manual.scheduledFor,
      scheduledTime: '17:00',
      timezone: 'UTC',
    }),
  })
  await repository.updateItem({
    context,
    itemId: item.id,
    input: selfCareItemUpdateInputSchema.parse({
      courseDetails: { ...courseDetails, isPaused: true },
    }),
  })
  const paused = await repository.getOccurrences({ context, from: today, to })
  assert.deepEqual(
    paused.map((entry) => entry.id),
    [manual.id],
  )
  await repository.updateItem({
    context,
    itemId: item.id,
    input: selfCareItemUpdateInputSchema.parse({
      courseDetails: { ...courseDetails, isPaused: false },
    }),
  })
  const resumed = await repository.getOccurrences({ context, from: today, to })
  assert.equal(resumed.length, 5)
  assert.equal(
    resumed.find((entry) => entry.id === manual.id)?.dueAt,
    `${manual.scheduledFor}T17:00:00.000Z`,
  )
}
