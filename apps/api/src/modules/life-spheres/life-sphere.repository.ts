import type {
  CreateLifeSphereCommand,
  DeleteLifeSphereCommand,
  LifeSphereReadContext,
  StoredLifeSphereRecord,
  UpdateLifeSphereCommand,
  WeeklySphereStatsCommand,
  WeeklySphereStatsResult,
} from './life-sphere.model.js'

export interface LifeSphereRepository {
  listByWorkspace(
    context: LifeSphereReadContext,
  ): Promise<StoredLifeSphereRecord[]>
  getById(
    context: LifeSphereReadContext,
    sphereId: string,
  ): Promise<StoredLifeSphereRecord>
  create(command: CreateLifeSphereCommand): Promise<StoredLifeSphereRecord>
  update(command: UpdateLifeSphereCommand): Promise<StoredLifeSphereRecord>
  remove(command: DeleteLifeSphereCommand): Promise<void>
  getWeeklyStats(
    command: WeeklySphereStatsCommand,
  ): Promise<WeeklySphereStatsResult>
}
