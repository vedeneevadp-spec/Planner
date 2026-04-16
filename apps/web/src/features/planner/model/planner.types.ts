import type {
  NewTaskInput,
  Task,
  TaskScheduleInput,
  TaskStatus,
} from '@/entities/task'

export interface PlannerState {
  tasks: Task[]
  isLoading: boolean
  isSyncing: boolean
  errorMessage: string | null
  isTaskPending: (taskId: string) => boolean
  refresh: () => Promise<void>
  addTask: (input: NewTaskInput) => Promise<boolean>
  setTaskStatus: (taskId: string, status: TaskStatus) => Promise<boolean>
  setTaskPlannedDate: (
    taskId: string,
    plannedDate: string | null,
  ) => Promise<boolean>
  setTaskSchedule: (
    taskId: string,
    schedule: TaskScheduleInput,
  ) => Promise<boolean>
  removeTask: (taskId: string) => Promise<boolean>
}
