import type {
  CreateTaskCommand,
  DeleteTaskCommand,
  StoredTaskRecord,
  TaskListFilters,
  UpdateTaskScheduleCommand,
  UpdateTaskStatusCommand,
} from './task.model.js'

export interface TaskRepository {
  listByWorkspace(
    workspaceId: string,
    filters?: TaskListFilters,
  ): Promise<StoredTaskRecord[]>
  create(command: CreateTaskCommand): Promise<StoredTaskRecord>
  updateStatus(command: UpdateTaskStatusCommand): Promise<StoredTaskRecord>
  updateSchedule(command: UpdateTaskScheduleCommand): Promise<StoredTaskRecord>
  remove(command: DeleteTaskCommand): Promise<void>
}
