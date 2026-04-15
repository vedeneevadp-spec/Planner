import { useEffect, useState } from 'react'

import {
  addTask as addTaskToList,
  removeTask as removeTaskFromList,
  setTaskPlannedDate as setTaskPlannedDateInList,
  setTaskStatus as setTaskStatusInList,
  sortTasks,
} from '@/entities/task/model/planner'
import type {
  NewTaskInput,
  Task,
  TaskStatus,
} from '@/entities/task/model/task.types'
import { loadTasks, saveTasks } from '@/shared/lib/storage/planner-storage'

export interface PlannerState {
  tasks: Task[]
  addTask: (input: NewTaskInput) => void
  setTaskStatus: (taskId: string, status: TaskStatus) => void
  setTaskPlannedDate: (taskId: string, plannedDate: string | null) => void
  removeTask: (taskId: string) => void
}

export function usePlannerState(): PlannerState {
  const [tasks, setTasks] = useState<Task[]>(() => sortTasks(loadTasks()))

  useEffect(() => {
    saveTasks(tasks)
  }, [tasks])

  function addTask(input: NewTaskInput) {
    setTasks((currentTasks) => addTaskToList(currentTasks, input))
  }

  function setTaskStatus(taskId: string, status: TaskStatus) {
    setTasks((currentTasks) =>
      setTaskStatusInList(currentTasks, taskId, status),
    )
  }

  function setTaskPlannedDate(taskId: string, plannedDate: string | null) {
    setTasks((currentTasks) =>
      setTaskPlannedDateInList(currentTasks, taskId, plannedDate),
    )
  }

  function removeTask(taskId: string) {
    setTasks((currentTasks) => removeTaskFromList(currentTasks, taskId))
  }

  return {
    tasks,
    addTask,
    setTaskStatus,
    setTaskPlannedDate,
    removeTask,
  }
}
