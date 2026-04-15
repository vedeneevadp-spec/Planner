export type TaskStatus = 'todo' | 'done'

export interface Task {
  id: string
  title: string
  note: string
  project: string
  status: TaskStatus
  plannedDate: string | null
  dueDate: string | null
  createdAt: string
  completedAt: string | null
}

export interface NewTaskInput {
  title: string
  note: string
  project: string
  plannedDate: string | null
  dueDate: string | null
}
