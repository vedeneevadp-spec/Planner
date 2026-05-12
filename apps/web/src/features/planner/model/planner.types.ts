import type {
  NewProjectInput,
  Project,
  ProjectUpdateInput,
} from '@/entities/project'
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

export interface PlannerState {
  projects: Project[]
  tasks: Task[]
  taskTemplates: TaskTemplate[]
  conflictedMutationCount: number
  isLoading: boolean
  isSyncing: boolean
  queuedMutationCount: number
  errorMessage: string | null
  isTaskPending: (taskId: string) => boolean
  refresh: () => Promise<void>
  addProject: (input: NewProjectInput) => Promise<boolean>
  addTask: (input: NewTaskInput) => Promise<boolean>
  addTaskTemplate: (input: NewTaskTemplateInput) => Promise<boolean>
  updateTask: (taskId: string, input: TaskUpdateInput) => Promise<boolean>
  updateProject: (
    projectId: string,
    input: ProjectUpdateInput,
  ) => Promise<boolean>
  removeProject: (projectId: string) => Promise<boolean>
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
