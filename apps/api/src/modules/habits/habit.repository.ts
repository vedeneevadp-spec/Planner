import type {
  CreateHabitCommand,
  DeleteHabitCommand,
  DeleteHabitEntryCommand,
  GetHabitStatsCommand,
  GetHabitTodayCommand,
  HabitReadContext,
  HabitStatsResult,
  HabitTodayResult,
  StoredHabitEntryRecord,
  StoredHabitRecord,
  UpdateHabitCommand,
  UpsertHabitEntryCommand,
} from './habit.model.js'

export interface HabitRepository {
  create: (command: CreateHabitCommand) => Promise<StoredHabitRecord>
  getStats: (command: GetHabitStatsCommand) => Promise<HabitStatsResult>
  getToday: (command: GetHabitTodayCommand) => Promise<HabitTodayResult>
  listByWorkspace: (context: HabitReadContext) => Promise<StoredHabitRecord[]>
  remove: (command: DeleteHabitCommand) => Promise<void>
  removeEntry: (command: DeleteHabitEntryCommand) => Promise<void>
  update: (command: UpdateHabitCommand) => Promise<StoredHabitRecord>
  upsertEntry: (
    command: UpsertHabitEntryCommand,
  ) => Promise<StoredHabitEntryRecord>
}
