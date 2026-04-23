import type {
  AutoBuildDailyPlanCommand,
  DailyPlanUnloadResult,
  GetDailyPlanCommand,
  StoredDailyPlanRecord,
  UnloadDailyPlanCommand,
  UpsertDailyPlanCommand,
} from './daily-plan.model.js'

export interface DailyPlanRepository {
  getByDate(command: GetDailyPlanCommand): Promise<StoredDailyPlanRecord>
  upsert(command: UpsertDailyPlanCommand): Promise<StoredDailyPlanRecord>
  autoBuild(command: AutoBuildDailyPlanCommand): Promise<StoredDailyPlanRecord>
  unload(command: UnloadDailyPlanCommand): Promise<DailyPlanUnloadResult>
}
