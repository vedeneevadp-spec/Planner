import type { PlannerIntent } from '@planner/contracts'
import { describe, expect, it } from 'vitest'

import {
  buildTaskInputFromPlannerIntent,
  getPlannerIntentActionLabel,
  getPlannerIntentTitle,
  isExecutablePlannerIntent,
  shouldAutoConfirmPlannerIntent,
} from './planner-intent-execution'

describe('planner intent execution helpers', () => {
  it('labels every PlannerIntent v1 action', () => {
    expect(getPlannerIntentActionLabel(createTaskIntent())).toBe(
      'Создать задачу',
    )
    expect(
      getPlannerIntentActionLabel(
        createIntent({
          intent: 'add_shopping_item',
          items: [{ title: 'молоко' }],
        }),
      ),
    ).toBe('Добавить покупку')
    expect(
      getPlannerIntentActionLabel(
        createIntent({
          intent: 'reschedule_task',
          targetQuery: 'помыть окна',
        }),
      ),
    ).toBe('Перенести')
    expect(
      getPlannerIntentActionLabel(
        createIntent({
          intent: 'get_shopping_list',
          needsConfirmation: false,
        }),
      ),
    ).toBe('Показать покупки')
    expect(
      getPlannerIntentActionLabel(
        createIntent({
          date: '2026-05-29',
          intent: 'get_agenda',
        }),
      ),
    ).toBe('Показать план')
    expect(
      getPlannerIntentActionLabel(createIntent({ intent: 'clarify' })),
    ).toBe('Уточнить')
    expect(
      getPlannerIntentActionLabel(createIntent({ intent: 'unsupported' })),
    ).toBe('Не поддерживается')
  })

  it('executes only task creation and shopping item intents', () => {
    expect(isExecutablePlannerIntent(createTaskIntent())).toBe(true)
    expect(
      isExecutablePlannerIntent(
        createIntent({
          intent: 'add_shopping_item',
          items: [{ title: 'хлеб' }],
        }),
      ),
    ).toBe(true)
    expect(
      isExecutablePlannerIntent(
        createIntent({
          intent: 'reschedule_task',
          targetQuery: 'помыть окна',
        }),
      ),
    ).toBe(false)
    expect(
      isExecutablePlannerIntent(
        createIntent({
          date: '2026-05-29',
          intent: 'get_agenda',
        }),
      ),
    ).toBe(false)
    expect(
      isExecutablePlannerIntent(
        createIntent({
          intent: 'get_shopping_list',
          needsConfirmation: false,
        }),
      ),
    ).toBe(false)
  })

  it('keeps auto-confirm disabled until visual undo is ready', () => {
    expect(
      shouldAutoConfirmPlannerIntent(
        createTaskIntent({
          confidence: 0.99,
          datePrecision: 'relative',
          needsConfirmation: false,
          reminderAt: '2026-05-29T10:15',
        }),
      ),
    ).toBe(false)
  })

  it('builds task input from an exact date and time intent', () => {
    const taskInput = buildTaskInputFromPlannerIntent(
      createTaskIntent({
        date: '2026-05-29',
        sphereId: 'health',
        time: '09:00',
        title: 'стоматолог',
      }),
    )

    expect(taskInput).toMatchObject({
      icon: '',
      plannedDate: '2026-05-29',
      plannedEndTime: null,
      plannedStartTime: '09:00',
      remindBeforeStart: false,
      reminderOffsets: [],
      sphereId: 'health',
      title: 'стоматолог',
    })
  })

  it('builds reminder task input from reminderAt', () => {
    const taskInput = buildTaskInputFromPlannerIntent(
      createTaskIntent({
        datePrecision: 'relative',
        reminderAt: '2026-05-29T10:15',
        title: 'выключить плиту',
      }),
    )

    expect(taskInput).toMatchObject({
      icon: 'bell',
      plannedDate: '2026-05-29',
      plannedStartTime: '10:15',
      remindBeforeStart: true,
      reminderOffsets: [15],
      title: 'выключить плиту',
    })
    expect(taskInput.reminderTimeZone).toBeTruthy()
  })

  it('falls back to rawText when title is empty', () => {
    const intent = createTaskIntent({
      rawText: '  завтра проверить документы  ',
      title: ' ',
    })

    expect(getPlannerIntentTitle(intent)).toBe('завтра проверить документы')
    expect(buildTaskInputFromPlannerIntent(intent).title).toBe(
      'завтра проверить документы',
    )
  })
})

function createTaskIntent(
  overrides: Partial<PlannerIntent> = {},
): PlannerIntent {
  return createIntent({
    intent: 'create_task',
    title: 'позвонить врачу',
    ...overrides,
  })
}

function createIntent(overrides: Partial<PlannerIntent>): PlannerIntent {
  return {
    confidence: 0.9,
    intent: 'clarify',
    needsConfirmation: true,
    rawText: 'тестовая команда',
    ...overrides,
  } as PlannerIntent
}
