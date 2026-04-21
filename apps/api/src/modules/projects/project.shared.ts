import {
  generateUuidV7,
  type NewProjectInput,
  type ProjectUpdateInput,
} from '@planner/contracts'

import type { StoredProjectRecord } from './project.model.js'

export interface NormalizedProjectInput extends NewProjectInput {
  color: string
  description: string
  icon: string
  title: string
}

export function normalizeProjectInput(
  input: NewProjectInput,
): NormalizedProjectInput {
  return {
    ...input,
    color: input.color.trim(),
    description: input.description.trim(),
    icon: input.icon.trim(),
    title: input.title.trim(),
  }
}

export function normalizeProjectUpdateInput(
  input: ProjectUpdateInput,
): ProjectUpdateInput {
  return {
    ...(input.expectedVersion !== undefined
      ? { expectedVersion: input.expectedVersion }
      : {}),
    ...(input.title !== undefined ? { title: input.title.trim() } : {}),
    ...(input.description !== undefined
      ? { description: input.description.trim() }
      : {}),
    ...(input.color !== undefined ? { color: input.color.trim() } : {}),
    ...(input.icon !== undefined ? { icon: input.icon.trim() } : {}),
  }
}

export function createStoredProjectRecord(
  input: NewProjectInput,
  options: {
    id?: string
    now?: string
    workspaceId: string
  },
): StoredProjectRecord {
  const now = options.now ?? new Date().toISOString()
  const normalizedInput = normalizeProjectInput(input)

  return {
    color: normalizedInput.color,
    createdAt: now,
    deletedAt: null,
    description: normalizedInput.description,
    icon: normalizedInput.icon,
    id: normalizedInput.id ?? options.id ?? generateUuidV7(),
    status: 'active',
    title: normalizedInput.title,
    updatedAt: now,
    version: 1,
    workspaceId: options.workspaceId,
  }
}

export function applyProjectUpdate(
  project: StoredProjectRecord,
  input: ProjectUpdateInput,
  now: string = new Date().toISOString(),
): StoredProjectRecord {
  const normalizedInput = normalizeProjectUpdateInput(input)

  return {
    ...project,
    ...(normalizedInput.title !== undefined
      ? { title: normalizedInput.title }
      : {}),
    ...(normalizedInput.description !== undefined
      ? { description: normalizedInput.description }
      : {}),
    ...(normalizedInput.color !== undefined
      ? { color: normalizedInput.color }
      : {}),
    ...(normalizedInput.icon !== undefined
      ? { icon: normalizedInput.icon }
      : {}),
    updatedAt: now,
    version: project.version + 1,
  }
}

export function compareStoredProjects(
  left: StoredProjectRecord,
  right: StoredProjectRecord,
): number {
  if (left.title !== right.title) {
    return left.title.localeCompare(right.title)
  }

  if (left.createdAt === right.createdAt) {
    return 0
  }

  return left.createdAt < right.createdAt ? -1 : 1
}

export function sortStoredProjects(
  projects: StoredProjectRecord[],
): StoredProjectRecord[] {
  return [...projects].sort(compareStoredProjects)
}

export function buildProjectSlug(title: string, projectId: string): string {
  const baseSlug =
    title
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'project'

  return `${baseSlug}-${projectId.slice(0, 8)}`
}
