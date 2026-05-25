import type {
  LifeSphereUpdateInput,
  NewLifeSphereInput,
  Sphere,
} from '@/entities/sphere'
import type {
  NewTaskInput,
  Task,
  TaskScheduleInput,
  TaskStatus,
  TaskUpdateInput,
} from '@/entities/task'
import type {
  NewTaskTemplateInput,
  TaskTemplate,
} from '@/entities/task-template'
import type { SessionReadiness } from '@/features/session'

export interface PlannerState {
  spheres: Sphere[]
  tasks: Task[]
  taskTemplates: TaskTemplate[]
  readiness: SessionReadiness
  conflictedMutationCount: number
  isLoading: boolean
  isSyncing: boolean
  queuedMutationCount: number
  errorMessage: string | null
  debugErrorDetails: string | null
  isTaskPending: (taskId: string) => boolean
  refresh: () => Promise<void>
  addSphere: (input: NewLifeSphereInput) => Promise<boolean>
  addTask: (input: NewTaskInput) => Promise<boolean>
  addTaskTemplate: (input: NewTaskTemplateInput) => Promise<boolean>
  copyTaskToPersonal: (taskId: string) => Promise<boolean>
  moveTaskToPersonal: (taskId: string) => Promise<boolean>
  updateTask: (taskId: string, input: TaskUpdateInput) => Promise<boolean>
  updateSphere: (
    sphereId: string,
    input: LifeSphereUpdateInput,
  ) => Promise<boolean>
  removeSphere: (sphereId: string) => Promise<boolean>
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
  removeTaskTemplate: (templateId: string) => Promise<boolean>
}
