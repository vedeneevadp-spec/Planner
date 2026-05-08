import { generateUuidV7 } from '@planner/contracts'

import type {
  AutoBuildDailyPlanCommand,
  DailyPlanUnloadResult,
  GetDailyPlanCommand,
  StoredDailyPlanRecord,
  UnloadDailyPlanCommand,
  UpsertDailyPlanCommand,
} from './daily-plan.model.js'
import type { DailyPlanRepository } from './daily-plan.repository.js'
import { createVirtualDailyPlan } from './daily-plan.shared.js'

export class MemoryDailyPlanRepository implements DailyPlanRepository {
  private readonly plans = new Map<string, StoredDailyPlanRecord>()

  getByDate(command: GetDailyPlanCommand): Promise<StoredDailyPlanRecord> {
    const key = this.createKey(
      command.context.workspaceId,
      command.context.actorUserId ?? '',
      command.date,
    )
    const plan = this.plans.get(key)

    return Promise.resolve(
      plan ??
        createVirtualDailyPlan({
          date: command.date,
          userId: command.context.actorUserId ?? '',
          workspaceId: command.context.workspaceId,
        }),
    )
  }

  upsert(command: UpsertDailyPlanCommand): Promise<StoredDailyPlanRecord> {
    const key = this.createKey(
      command.context.workspaceId,
      command.context.actorUserId,
      command.date,
    )
    const existing = this.plans.get(key)
    const now = new Date().toISOString()
    const plan: StoredDailyPlanRecord = {
      createdAt: existing?.createdAt ?? now,
      date: command.date,
      deletedAt: null,
      energyMode: command.input.energyMode,
      focusTaskIds: command.input.focusTaskIds,
      id: existing?.id ?? generateUuidV7(),
      overloadScore: 0,
      routineTaskIds: command.input.routineTaskIds,
      supportTaskIds: command.input.supportTaskIds,
      updatedAt: now,
      userId: command.context.actorUserId,
      version: existing ? existing.version + 1 : 1,
      workspaceId: command.context.workspaceId,
    }

    this.plans.set(key, plan)

    return Promise.resolve(plan)
  }

  autoBuild(
    command: AutoBuildDailyPlanCommand,
  ): Promise<StoredDailyPlanRecord> {
    return this.upsert({
      context: command.context,
      date: command.input.date,
      input: {
        energyMode: command.input.energyMode,
        focusTaskIds: [],
        routineTaskIds: [],
        supportTaskIds: [],
      },
    })
  }

  unload(_command: UnloadDailyPlanCommand): Promise<DailyPlanUnloadResult> {
    return Promise.resolve({ suggestions: [] })
  }

  private createKey(workspaceId: string, userId: string, date: string): string {
    return `${workspaceId}:${userId}:${date}`
  }
}
