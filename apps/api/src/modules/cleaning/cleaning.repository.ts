import type {
  CleaningListResult,
  CleaningReadContext,
  CleaningTaskActionResult,
  CleaningTodayResult,
  CreateCleaningTaskCommand,
  CreateCleaningZoneCommand,
  DeleteCleaningTaskCommand,
  DeleteCleaningZoneCommand,
  GetCleaningTodayCommand,
  RecordCleaningTaskActionCommand,
  StoredCleaningTaskRecord,
  StoredCleaningZoneRecord,
  UpdateCleaningTaskCommand,
  UpdateCleaningZoneCommand,
} from './cleaning.model.js'

export interface CleaningRepository {
  createTask: (
    command: CreateCleaningTaskCommand,
  ) => Promise<StoredCleaningTaskRecord>
  createZone: (
    command: CreateCleaningZoneCommand,
  ) => Promise<StoredCleaningZoneRecord>
  getToday: (command: GetCleaningTodayCommand) => Promise<CleaningTodayResult>
  listByWorkspace: (context: CleaningReadContext) => Promise<CleaningListResult>
  recordTaskAction: (
    command: RecordCleaningTaskActionCommand,
  ) => Promise<CleaningTaskActionResult>
  removeTask: (command: DeleteCleaningTaskCommand) => Promise<void>
  removeZone: (command: DeleteCleaningZoneCommand) => Promise<void>
  updateTask: (
    command: UpdateCleaningTaskCommand,
  ) => Promise<StoredCleaningTaskRecord>
  updateZone: (
    command: UpdateCleaningZoneCommand,
  ) => Promise<StoredCleaningZoneRecord>
}
