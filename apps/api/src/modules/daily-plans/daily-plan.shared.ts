import { type EnergyMode,generateUuidV7 } from '@planner/contracts'

import type { StoredDailyPlanRecord } from './daily-plan.model.js'

export const DAILY_RESOURCE_LIMITS: Record<EnergyMode, number> = {
  minimum: 4,
  normal: 8,
  maximum: 12,
}

export const DAILY_FOCUS_LIMITS: Record<EnergyMode, number> = {
  minimum: 1,
  normal: 3,
  maximum: 5,
}

export const DEFAULT_TASK_RESOURCE = 2

export function calculateOverloadScore(
  totalResource: number,
  energyMode: EnergyMode,
): number {
  return Math.round((totalResource / DAILY_RESOURCE_LIMITS[energyMode]) * 100)
}

export function createVirtualDailyPlan(options: {
  date: string
  energyMode?: EnergyMode
  userId: string
  workspaceId: string
}): StoredDailyPlanRecord {
  const now = new Date().toISOString()

  return {
    createdAt: now,
    date: options.date,
    deletedAt: null,
    energyMode: options.energyMode ?? 'normal',
    focusTaskIds: [],
    id: generateUuidV7(),
    overloadScore: 0,
    routineTaskIds: [],
    supportTaskIds: [],
    updatedAt: now,
    userId: options.userId,
    version: 1,
    workspaceId: options.workspaceId,
  }
}

export function isRoutineTitle(value: string): boolean {
  const title = value.toLowerCase()

  return [
    'быт',
    'готов',
    'детсад',
    'ежеднев',
    'забрать',
    'корм',
    'оплат',
    'покуп',
    'прогул',
    'рутин',
    'уборк',
    'школ',
  ].some((keyword) => title.includes(keyword))
}
