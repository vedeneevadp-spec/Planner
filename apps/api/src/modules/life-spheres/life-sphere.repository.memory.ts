import { HttpError } from '../../bootstrap/http-error.js'
import type {
  CreateLifeSphereCommand,
  DeleteLifeSphereCommand,
  LifeSphereReadContext,
  StoredLifeSphereRecord,
  UpdateLifeSphereCommand,
  WeeklySphereStatsCommand,
  WeeklySphereStatsResult,
} from './life-sphere.model.js'
import type { LifeSphereRepository } from './life-sphere.repository.js'
import { createStoredLifeSphereRecord } from './life-sphere.shared.js'

export class MemoryLifeSphereRepository implements LifeSphereRepository {
  private readonly spheres = new Map<string, StoredLifeSphereRecord>()

  listByWorkspace(
    context: LifeSphereReadContext,
  ): Promise<StoredLifeSphereRecord[]> {
    return Promise.resolve(this.listActiveSpheres(context))
  }

  getById(
    context: LifeSphereReadContext,
    sphereId: string,
  ): Promise<StoredLifeSphereRecord> {
    return Promise.resolve(this.getSphereOrThrow(context.workspaceId, sphereId))
  }

  create(command: CreateLifeSphereCommand): Promise<StoredLifeSphereRecord> {
    const sphere = createStoredLifeSphereRecord(command.input, {
      sortOrder: this.listActiveSpheres(command.context).length,
      userId: command.context.actorUserId,
      workspaceId: command.context.workspaceId,
    })

    this.spheres.set(sphere.id, sphere)

    return Promise.resolve(sphere)
  }

  update(command: UpdateLifeSphereCommand): Promise<StoredLifeSphereRecord> {
    const sphere = this.getSphereOrThrow(
      command.context.workspaceId,
      command.sphereId,
    )
    const nextSphere: StoredLifeSphereRecord = {
      ...sphere,
      ...(command.input.name !== undefined
        ? { name: command.input.name.trim() }
        : {}),
      ...(command.input.description !== undefined
        ? { description: command.input.description.trim() }
        : {}),
      ...(command.input.color !== undefined
        ? { color: command.input.color.trim() }
        : {}),
      ...(command.input.icon !== undefined
        ? { icon: command.input.icon.trim() }
        : {}),
      ...(command.input.isActive !== undefined
        ? { isActive: command.input.isActive }
        : {}),
      ...(command.input.sortOrder !== undefined
        ? { sortOrder: command.input.sortOrder }
        : {}),
      updatedAt: new Date().toISOString(),
      version: sphere.version + 1,
    }

    this.spheres.set(nextSphere.id, nextSphere)

    return Promise.resolve(nextSphere)
  }

  remove(command: DeleteLifeSphereCommand): Promise<void> {
    const sphere = this.getSphereOrThrow(
      command.context.workspaceId,
      command.sphereId,
    )

    this.spheres.set(sphere.id, {
      ...sphere,
      deletedAt: new Date().toISOString(),
      isActive: false,
      updatedAt: new Date().toISOString(),
      version: sphere.version + 1,
    })

    return Promise.resolve()
  }

  getWeeklyStats(
    command: WeeklySphereStatsCommand,
  ): Promise<WeeklySphereStatsResult> {
    const spheres = this.listActiveSpheres(command.context)

    return Promise.resolve({
      from: command.from,
      spheres,
      stats: spheres.map((sphere) => ({
        completedCount: 0,
        health: 'abandoned',
        lastActivityAt: null,
        overdueCount: 0,
        plannedCount: 0,
        sphereId: sphere.id,
        totalResource: 0,
        weeklyShare: 0,
      })),
      to: command.to,
    })
  }

  private listActiveSpheres(
    context: Pick<LifeSphereReadContext, 'actorUserId' | 'workspaceId'>,
  ): StoredLifeSphereRecord[] {
    return [...this.spheres.values()]
      .filter(
        (sphere) =>
          sphere.workspaceId === context.workspaceId &&
          (!context.actorUserId || sphere.userId === context.actorUserId) &&
          sphere.deletedAt === null &&
          sphere.isActive,
      )
      .sort((left, right) => left.sortOrder - right.sortOrder)
  }

  private getSphereOrThrow(
    workspaceId: string,
    sphereId: string,
  ): StoredLifeSphereRecord {
    const sphere = this.spheres.get(sphereId)

    if (!sphere || sphere.workspaceId !== workspaceId || sphere.deletedAt) {
      throw new HttpError(
        404,
        'life_sphere_not_found',
        'Life sphere not found.',
      )
    }

    return sphere
  }
}
