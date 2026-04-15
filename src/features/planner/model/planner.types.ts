import type {
  NewTaskInput,
  Task,
  TaskScheduleInput,
  TaskStatus,
} from '@/entities/task'

export interface PlannerState {
  tasks: Task[]
  addTask: (input: NewTaskInput) => void
  setTaskStatus: (taskId: string, status: TaskStatus) => void
  setTaskPlannedDate: (taskId: string, plannedDate: string | null) => void
  setTaskSchedule: (taskId: string, schedule: TaskScheduleInput) => void
  removeTask: (taskId: string) => void
}
