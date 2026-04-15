import type {
  NewTaskInput,
  Task,
  TaskStatus,
} from '@/entities/task'

export interface PlannerState {
  tasks: Task[]
  addTask: (input: NewTaskInput) => void
  setTaskStatus: (taskId: string, status: TaskStatus) => void
  setTaskPlannedDate: (taskId: string, plannedDate: string | null) => void
  removeTask: (taskId: string) => void
}
