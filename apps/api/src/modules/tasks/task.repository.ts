import type {
  CreateTaskCommand,
  DeleteTaskCommand,
  StoredTaskRecord,
  TaskEventFilters,
  TaskEventListResult,
  TaskListFilters,
  TaskReadContext,
  UpdateTaskScheduleCommand,
  UpdateTaskStatusCommand,
} from './task.model.js'

export interface TaskRepository {
  listByWorkspace(
    context: TaskReadContext,
    filters?: TaskListFilters,
  ): Promise<StoredTaskRecord[]>
  listEventsByWorkspace(
    context: TaskReadContext,
    filters?: TaskEventFilters,
  ): Promise<TaskEventListResult>
  create(command: CreateTaskCommand): Promise<StoredTaskRecord>
  updateStatus(command: UpdateTaskStatusCommand): Promise<StoredTaskRecord>
  updateSchedule(command: UpdateTaskScheduleCommand): Promise<StoredTaskRecord>
  remove(command: DeleteTaskCommand): Promise<void>
}
