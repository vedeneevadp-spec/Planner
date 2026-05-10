import type {
  CreateTaskCommand,
  DeleteTaskCommand,
  StoredTaskRecord,
  TaskEventFilters,
  TaskEventListResult,
  TaskListFilters,
  TaskListPageResult,
  TaskReadContext,
  UpdateTaskCommand,
  UpdateTaskScheduleCommand,
  UpdateTaskStatusCommand,
} from './task.model.js'

export interface TaskRepository {
  listByWorkspace(
    context: TaskReadContext,
    filters?: TaskListFilters,
  ): Promise<StoredTaskRecord[]>
  listPageByWorkspace(
    context: TaskReadContext,
    filters?: TaskListFilters,
  ): Promise<TaskListPageResult>
  findById(
    context: TaskReadContext,
    taskId: string,
  ): Promise<StoredTaskRecord | null>
  listEventsByWorkspace(
    context: TaskReadContext,
    filters?: TaskEventFilters,
  ): Promise<TaskEventListResult>
  create(command: CreateTaskCommand): Promise<StoredTaskRecord>
  update(command: UpdateTaskCommand): Promise<StoredTaskRecord>
  updateStatus(command: UpdateTaskStatusCommand): Promise<StoredTaskRecord>
  updateSchedule(command: UpdateTaskScheduleCommand): Promise<StoredTaskRecord>
  remove(command: DeleteTaskCommand): Promise<void>
}
