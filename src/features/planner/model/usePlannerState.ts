import { useEffect, useState } from 'react'

import type {
  NewTaskInput,
  Task,
  TaskScheduleInput,
  TaskStatus,
} from '@/entities/task'
import {
  addTask as addTaskToList,
  removeTask as removeTaskFromList,
  setTaskPlannedDate as setTaskPlannedDateInList,
  setTaskSchedule as setTaskScheduleInList,
  setTaskStatus as setTaskStatusInList,
  sortTasks,
} from '@/entities/task'

import { loadTasks, saveTasks } from '../lib/planner-storage'
import type { PlannerState } from './planner.types'

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

  function setTaskSchedule(taskId: string, schedule: TaskScheduleInput) {
    setTasks((currentTasks) =>
      setTaskScheduleInList(currentTasks, taskId, schedule),
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
    setTaskSchedule,
    removeTask,
  }
}
