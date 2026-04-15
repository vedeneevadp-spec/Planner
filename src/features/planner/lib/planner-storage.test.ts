import { describe, expect, it } from 'vitest'

import {
  loadTasks,
  saveTasks,
  type StorageLike,
} from './planner-storage'

function createStorage(seed: Record<string, string> = {}): StorageLike {
  const store = new Map(Object.entries(seed))

  return {
    getItem(key) {
      return store.get(key) ?? null
    },
    setItem(key, value) {
      store.set(key, value)
    },
  }
}

describe('planner storage', () => {
  it('loads validated tasks from storage', () => {
    const storage = createStorage({
      'planner.tasks.v1': JSON.stringify([
        {
          id: 'task-1',
          title: 'Ship setup',
          note: '',
          project: 'Planner',
          status: 'todo',
          plannedDate: null,
          dueDate: null,
          createdAt: '2026-04-15T09:00:00.000Z',
          completedAt: null,
        },
      ]),
    })

    expect(loadTasks(storage)).toHaveLength(1)
  })

  it('returns an empty list for invalid payloads', () => {
    const storage = createStorage({
      'planner.tasks.v1': JSON.stringify([{ broken: true }]),
    })

    expect(loadTasks(storage)).toEqual([])
  })

  it('saves serialized tasks into the provided storage', () => {
    const storage = createStorage()

    saveTasks(
      [
        {
          id: 'task-1',
          title: 'Ship setup',
          note: '',
          project: 'Planner',
          status: 'todo',
          plannedDate: null,
          dueDate: null,
          createdAt: '2026-04-15T09:00:00.000Z',
          completedAt: null,
        },
      ],
      storage,
    )

    expect(loadTasks(storage)).toMatchObject([
      {
        id: 'task-1',
        title: 'Ship setup',
      },
    ])
  })
})
