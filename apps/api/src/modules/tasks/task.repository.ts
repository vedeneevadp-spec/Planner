import type {
  CloseTaskChainCommand,
  CopyTaskToPersonalCommand,
  CreateTaskCommand,
  CreateTaskNextStageCommand,
  DeleteTaskCommand,
  DetachTaskChainCommand,
  MoveTaskToPersonalCommand,
  StoredTaskRecord,
  TaskEventFilters,
  TaskEventListResult,
  TaskListFilters,
  TaskListPageResult,
  TaskNextStageResult,
  TaskReadContext,
  UndoTaskNextStageCommand,
  UndoTaskNextStageResult,
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
  closeChain(command: CloseTaskChainCommand): Promise<StoredTaskRecord>
  copyToPersonal(command: CopyTaskToPersonalCommand): Promise<StoredTaskRecord>
  create(command: CreateTaskCommand): Promise<StoredTaskRecord>
  createNextStage(
    command: CreateTaskNextStageCommand,
  ): Promise<TaskNextStageResult>
  detachFromChain(command: DetachTaskChainCommand): Promise<StoredTaskRecord>
  moveToPersonal(command: MoveTaskToPersonalCommand): Promise<StoredTaskRecord>
  undoCreateNextStage(
    command: UndoTaskNextStageCommand,
  ): Promise<UndoTaskNextStageResult>
  update(command: UpdateTaskCommand): Promise<StoredTaskRecord>
  updateStatus(command: UpdateTaskStatusCommand): Promise<StoredTaskRecord>
  updateSchedule(command: UpdateTaskScheduleCommand): Promise<StoredTaskRecord>
  remove(command: DeleteTaskCommand): Promise<void>
}
