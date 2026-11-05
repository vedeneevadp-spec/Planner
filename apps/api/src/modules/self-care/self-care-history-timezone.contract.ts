import assert from 'node:assert/strict'

import {
  addDateDays,
  selfCareCompletionInputSchema,
  selfCareItemInputSchema,
  selfCareRitualCompletionInputSchema,
} from '@planner/contracts'

import type { SelfCareWriteContext } from './self-care.model.js'
import type { SelfCareRepository } from './self-care.repository.js'

export const HISTORY_TIMEZONE_CASES = [
  {
    date: '2026-11-01',
    endUtc: '2026-11-01T17:00:00.000Z',
    startUtc: '2026-10-31T17:00:00.000Z',
    timezone: 'Asia/Novosibirsk',
  },
  {
    date: '2026-11-01',
    endUtc: '2026-11-02T08:00:00.000Z',
    startUtc: '2026-11-01T07:00:00.000Z',
    timezone: 'America/Los_Angeles',
  },
  {
    date: '2026-03-29',
    endUtc: '2026-03-29T22:00:00.000Z',
    startUtc: '2026-03-28T23:00:00.000Z',
    timezone: 'Europe/Amsterdam',
  },
] as const

export async function assertSelfCareHistoryUsesLocalDates(
  repository: SelfCareRepository,
  baseContext: SelfCareWriteContext,
  scenario: (typeof HISTORY_TIMEZONE_CASES)[number],
) {
  const context = { ...baseContext, clientTimeZone: scenario.timezone }
  const instants = [
    new Date(Date.parse(scenario.startUtc) - 1).toISOString(),
    scenario.startUtc,
    new Date(Date.parse(scenario.endUtc) - 1).toISOString(),
    scenario.endUtc,
  ]
  const completionIds: string[] = []

  for (const [index, completedAt] of instants.entries()) {
    const item = await repository.createItem({
      context,
      input: selfCareItemInputSchema.parse({
        category: 'relax',
        title: `Boundary procedure ${index}`,
        type: 'procedure',
      }),
    })
    const completion = await repository.completeItemNow({
      context,
      input: selfCareRitualCompletionInputSchema.parse({
        completedAt,
        price: 10,
        status: 'done',
      }),
      itemId: item.id,
    })
    completionIds.push(completion.id)
  }

  const history = await repository.getHistory(
    context,
    scenario.date,
    scenario.date,
  )
  assert.deepEqual(
    new Set(history.completions.map((completion) => completion.id)),
    new Set(completionIds.slice(1, 3)),
  )
  const analytics = await repository.getAnalytics(
    context,
    scenario.date,
    scenario.date,
  )
  assert.equal(analytics.selectedSelfCareCount, 2)
  assert.deepEqual(analytics.completionsByDay, { [scenario.date]: 2 })
  assert.equal(analytics.procedureCosts, 20)
  assert.deepEqual(analytics.procedureCostsByMonth, {
    [scenario.date.slice(0, 7)]: 20,
  })

  const previousDate = addDateDays(scenario.date, -1)
  const previous = await repository.getHistory(
    context,
    previousDate,
    previousDate,
  )
  assert.deepEqual(
    previous.completions.map((completion) => completion.id),
    [completionIds[0]],
  )
  const nextDate = addDateDays(scenario.date, 1)
  const next = await repository.getHistory(context, nextDate, nextDate)
  assert.deepEqual(
    next.completions.map((completion) => completion.id),
    [completionIds[3]],
  )
}

export async function assertSelfCareFlexibleProgressUsesLocalDates(
  repository: SelfCareRepository,
  baseContext: SelfCareWriteContext,
) {
  const context = { ...baseContext, clientTimeZone: 'Asia/Novosibirsk' }
  for (const period of ['day', 'week', 'month'] as const) {
    const date = period === 'month' ? '2026-11-01' : '2026-11-02'
    const previousDate = addDateDays(date, -1)
    const item = await repository.createItem({
      context,
      input: selfCareItemInputSchema.parse({
        category: 'daily_base',
        title: `Local ${period} goal`,
        type: 'flexible_goal',
        scheduleRule: {
          repeatKind: 'flexible_goal',
          flexiblePeriod: period,
          flexibleTargetCount: 10,
          startDate: '2026-10-01',
        },
      }),
    })
    await repository.completeFlexibleGoal({
      context,
      itemId: item.id,
      input: selfCareCompletionInputSchema.parse({
        completedAt: `${previousDate}T17:00:00.000Z`,
        status: 'done',
      }),
    })
    const today = await repository.getDashboard({ context, date })
    assert.equal(
      today.flexibleGoals.find((goal) => goal.item.id === item.id)
        ?.flexibleProgress?.completedCount,
      1,
    )
    const previous = await repository.getDashboard({
      context,
      date: previousDate,
    })
    assert.equal(
      previous.flexibleGoals.find((goal) => goal.item.id === item.id)
        ?.flexibleProgress?.completedCount,
      0,
    )
    const analyticsDate = period === 'day' ? date : addDateDays(date, 2)
    const analytics = await repository.getAnalytics(
      context,
      analyticsDate,
      analyticsDate,
    )
    assert.equal(
      analytics.flexibleGoals.find((goal) => goal.item.id === item.id)
        ?.flexibleProgress?.completedCount,
      1,
    )
    if (period !== 'day') assert.deepEqual(analytics.completionsByDay, {})
  }

  const oneOff = await repository.createItem({
    context,
    input: selfCareItemInputSchema.parse({
      category: 'daily_base',
      title: 'Local one-off goal',
      type: 'flexible_goal',
      scheduleRule: {
        repeatKind: 'none',
        flexiblePeriod: 'day',
        flexibleTargetCount: 1,
        startDate: '2026-11-02',
      },
    }),
  })
  await repository.completeFlexibleGoal({
    context,
    itemId: oneOff.id,
    input: selfCareCompletionInputSchema.parse({
      completedAt: '2026-11-01T17:00:00.000Z',
      status: 'done',
    }),
  })
  assert.equal(
    (await repository.listItems(context)).items.find(
      (item) => item.id === oneOff.id,
    )?.isActive,
    false,
  )
}

export async function assertSelfCareAfterCompletionUsesLocalDates(
  repository: SelfCareRepository,
  baseContext: SelfCareWriteContext,
) {
  const context = { ...baseContext, clientTimeZone: 'Asia/Novosibirsk' }
  const item = await repository.createItem({
    context,
    input: selfCareItemInputSchema.parse({
      category: 'daily_base',
      title: 'Local after-completion task',
      type: 'task',
      scheduleRule: {
        repeatKind: 'after_completion',
        intervalUnit: 'day',
        intervalValue: 1,
        startDate: '2026-11-01',
      },
    }),
  })
  await repository.completeItemNow({
    context,
    itemId: item.id,
    input: selfCareRitualCompletionInputSchema.parse({
      completedAt: '2026-11-01T17:00:00.000Z',
      status: 'done',
    }),
  })
  const occurrences = await repository.getOccurrences({
    context,
    from: '2026-11-02',
    to: '2026-11-03',
  })
  assert.deepEqual(
    occurrences
      .filter((occurrence) => occurrence.itemId === item.id)
      .map((occurrence) => occurrence.scheduledFor),
    ['2026-11-03'],
  )

  const procedure = await repository.createItem({
    context,
    input: selfCareItemInputSchema.parse({
      category: 'relax',
      title: 'Local planning hint',
      type: 'procedure',
      scheduleRule: {
        repeatKind: 'after_completion',
        intervalUnit: 'day',
        intervalValue: 15,
        startDate: '2026-11-01',
      },
    }),
  })
  await repository.completeItemNow({
    context,
    itemId: procedure.id,
    input: selfCareRitualCompletionInputSchema.parse({
      completedAt: '2026-11-01T17:00:00.000Z',
      status: 'done',
    }),
  })
  const tooEarly = await repository.getPlan({
    context,
    from: '2026-11-02',
    to: '2026-11-02',
  })
  assert.equal(
    tooEarly.planningHints.some((hint) => hint.item.id === procedure.id),
    false,
  )
  const inHorizon = await repository.getPlan({
    context,
    from: '2026-11-03',
    to: '2026-11-03',
  })
  assert.equal(
    inHorizon.planningHints.some((hint) => hint.item.id === procedure.id),
    true,
  )
}
