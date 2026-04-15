import { z } from 'zod'

import type { Task } from '@/entities/task'

const STORAGE_KEY = 'planner.tasks.v1'

const nullableStringWithDefault = z
  .string()
  .nullable()
  .optional()
  .transform((value) => value ?? null)

const taskSchema = z.object({
  id: z.string(),
  title: z.string(),
  note: z.string(),
  project: z.string(),
  status: z.enum(['todo', 'done']),
  plannedDate: nullableStringWithDefault,
  plannedStartTime: nullableStringWithDefault,
  plannedEndTime: nullableStringWithDefault,
  dueDate: nullableStringWithDefault,
  createdAt: z.string(),
  completedAt: z.string().nullable(),
})

const tasksSchema = z.array(taskSchema)

export interface StorageLike {
  getItem: (key: string) => string | null
  setItem: (key: string, value: string) => void
}

function getDefaultStorage(): StorageLike | null {
  if (typeof window === 'undefined') {
    return null
  }

  return window.localStorage
}

export function loadTasks(
  storage: StorageLike | null = getDefaultStorage(),
): Task[] {
  if (!storage) {
    return []
  }

  try {
    const raw = storage.getItem(STORAGE_KEY)
    if (!raw) {
      return []
    }

    const parsed = JSON.parse(raw) as unknown
    const result = tasksSchema.safeParse(parsed)

    return result.success ? result.data : []
  } catch {
    return []
  }
}

export function saveTasks(
  tasks: Task[],
  storage: StorageLike | null = getDefaultStorage(),
): void {
  if (!storage) {
    return
  }

  const serializedTasks = JSON.stringify(tasksSchema.parse(tasks))
  storage.setItem(STORAGE_KEY, serializedTasks)
}
