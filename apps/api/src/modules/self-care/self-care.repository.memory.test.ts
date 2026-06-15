import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import test from 'node:test'

import {
  selfCareItemInputSchema,
  selfCareItemScheduleInputSchema,
  selfCareOccurrenceSkipInputSchema,
  selfCareRitualCompletionInputSchema,
} from '@planner/contracts'

import type { SelfCareWriteContext } from './self-care.model.js'
import { MemorySelfCareRepository } from './self-care.repository.memory.js'

void test('MemorySelfCareRepository reactivates an existing occurrence when it is scheduled again', async () => {
  const repository = new MemorySelfCareRepository()
  const context = createWriteContext()
  const item = await repository.createItem({
    context,
    input: selfCareItemInputSchema.parse({
      category: 'beauty',
      scheduleRule: {
        intervalUnit: 'week',
        intervalValue: 5,
        repeatKind: 'after_completion',
        startDate: '2026-06-08',
      },
      title: 'Педикюр',
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

void test('MemorySelfCareRepository marks stale daily occurrences as missed', async () => {
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

  assert.equal(occurrences[0]?.status, 'missed')
  assert.deepEqual(dashboard.overdueItems, [])
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
      title: 'Маникюр',
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

void test('MemorySelfCareRepository stores ad-hoc ritual step completion', async () => {
  const repository = new MemorySelfCareRepository()
  const context = createWriteContext()
  const item = await repository.createItem({
    context,
    input: selfCareItemInputSchema.parse({
      category: 'beauty',
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
      title: 'Утренний уход',
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
