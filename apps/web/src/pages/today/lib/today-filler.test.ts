import { describe, expect, it } from 'vitest'

import type { Task } from '@/entities/task'

import {
  buildTodayFillerSummary,
  getTodayFillerPhrase,
  TODAY_FILLER_PHRASES,
} from './today-filler'

function task(overrides: Partial<Task> = {}): Task {
  return {
    id: 'task',
    plannedStartTime: null,
    sphereId: null,
    title: 'Задача',
    ...overrides,
  } as Task
}

const emptyModel = { doneTodayTasks: [], mainTodayTasks: [], routineTasks: [] }

describe('getTodayFillerPhrase', () => {
  it('keeps the same phrase for a day and changes it on another day', () => {
    expect(getTodayFillerPhrase('2026-11-17')).toBe(
      getTodayFillerPhrase('2026-11-17'),
    )
    expect(
      new Set(
        ['2026-11-17', '2026-11-18', '2026-11-19'].map((day) =>
          getTodayFillerPhrase(day),
        ),
      ).size,
    ).toBeGreaterThan(1)
  })

  it('gives the second card on the page a different phrase', () => {
    expect(getTodayFillerPhrase('2026-11-17', 1)).not.toBe(
      getTodayFillerPhrase('2026-11-17', 0),
    )
    expect(TODAY_FILLER_PHRASES).toContain(
      getTodayFillerPhrase('2026-11-17', 1),
    )
  })
})

describe('buildTodayFillerSummary', () => {
  it('is empty when there is nothing worth summarising', () => {
    expect(
      buildTodayFillerSummary({
        model: emptyModel,
        nowTime: '10:00',
        spheres: [],
      }),
    ).toEqual([])
  })

  it('reports done count, the next timed task and the busiest sphere', () => {
    expect(
      buildTodayFillerSummary({
        model: {
          doneTodayTasks: [task(), task()],
          mainTodayTasks: [
            task({ plannedStartTime: '09:00', title: 'Прошло', sphereId: 'w' }),
            task({ plannedStartTime: '15:30', title: 'Позже', sphereId: 'w' }),
            task({ plannedStartTime: '13:30', title: 'Дейли', sphereId: 'h' }),
          ],
          routineTasks: [],
        },
        nowTime: '12:00',
        spheres: [
          { id: 'w', name: 'Работа' },
          { id: 'h', name: 'Дом' },
        ],
      }),
    ).toEqual([
      { count: 2, kind: 'done' },
      { kind: 'next', time: '13:30', title: 'Дейли' },
      { count: 2, kind: 'sphere', name: 'Работа' },
    ])
  })

  it('skips a sphere with a single task and tasks without a real sphere', () => {
    expect(
      buildTodayFillerSummary({
        model: {
          ...emptyModel,
          mainTodayTasks: [
            task({ sphereId: 'w' }),
            task({ project: 'Без сферы', sphereId: null }),
            task({ project: 'Без сферы', sphereId: null }),
          ],
        },
        nowTime: '12:00',
        spheres: [{ id: 'w', name: 'Работа' }],
      }),
    ).toEqual([])
  })
})
