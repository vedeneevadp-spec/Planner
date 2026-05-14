import { generateUuidV7, type NewLifeSphereInput } from '@planner/contracts'

import type { StoredLifeSphereRecord } from './life-sphere.model.js'

export const UNSPHERED_ID = '__unsphered__'

export const DEFAULT_LIFE_SPHERES: Array<{
  color: string
  description: string
  icon: string
  name: string
}> = [
  { name: 'Работа', description: '', color: '#2f6f62', icon: 'briefcase' },
  { name: 'Дом', description: '', color: '#c47f42', icon: 'home' },
  { name: 'Дети / семья', description: '', color: '#e0a84f', icon: 'heart' },
  { name: 'Здоровье', description: '', color: '#5f8f78', icon: 'activity' },
  { name: 'Отношения', description: '', color: '#b46a55', icon: 'heart' },
  { name: 'Я / личное', description: '', color: '#557a9f', icon: 'spark' },
  { name: 'Быт / покупки', description: '', color: '#8a7356', icon: 'cart' },
  { name: 'Финансы', description: '', color: '#596b3f', icon: 'wallet' },
]

export function buildLifeSphereSlug(name: string, sphereId: string): string {
  const baseSlug =
    name
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'sphere'

  return `${baseSlug}-${sphereId.slice(0, 8)}`
}

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
    color: input.color.trim(),
    createdAt: now,
    deletedAt: null,
    description: input.description.trim(),
    icon: input.icon.trim(),
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
