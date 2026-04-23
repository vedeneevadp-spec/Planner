import { generateUuidV7, type NewLifeSphereInput } from '@planner/contracts'

import type { StoredLifeSphereRecord } from './life-sphere.model.js'

export const UNSPHERED_ID = '__unsphered__'

export const DEFAULT_LIFE_SPHERES: Array<{
  color: string
  icon: string
  name: string
}> = [
  { name: 'Работа', color: '#2f6f62', icon: 'briefcase' },
  { name: 'Дом', color: '#c47f42', icon: 'home' },
  { name: 'Дети / семья', color: '#e0a84f', icon: 'heart' },
  { name: 'Здоровье', color: '#5f8f78', icon: 'activity' },
  { name: 'Отношения', color: '#b46a55', icon: 'heart' },
  { name: 'Я / личное', color: '#557a9f', icon: 'spark' },
  { name: 'Быт / покупки', color: '#8a7356', icon: 'cart' },
  { name: 'Финансы', color: '#596b3f', icon: 'wallet' },
]

export function createStoredLifeSphereRecord(
  input: NewLifeSphereInput,
  options: {
    id?: string
    now?: string
    sortOrder: number
    userId: string
    workspaceId: string
  },
): StoredLifeSphereRecord {
  const now = options.now ?? new Date().toISOString()

  return {
    color: input.color,
    createdAt: now,
    deletedAt: null,
    icon: input.icon,
    id: input.id ?? options.id ?? generateUuidV7(),
    isActive: true,
    isDefault: false,
    name: input.name.trim(),
    sortOrder: options.sortOrder,
    updatedAt: now,
    userId: options.userId,
    version: 1,
    workspaceId: options.workspaceId,
  }
}

export function resolveSphereHealth(options: {
  completedCount: number
  idleDays: number | null
  overdueCount: number
  plannedCount: number
}): 'abandoned' | 'healthy' | 'warning' {
  if (options.idleDays === null || options.idleDays >= 10) {
    return 'abandoned'
  }

  if (
    options.idleDays >= 5 ||
    options.overdueCount > 0 ||
    options.plannedCount + options.completedCount === 0
  ) {
    return 'warning'
  }

  return 'healthy'
}
