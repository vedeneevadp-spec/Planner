import { generateUuidV7, type NewChaosInboxItemInput } from '@planner/contracts'

import type { StoredChaosInboxItemRecord } from './chaos-inbox.model.js'

export function createStoredChaosInboxItemRecord(
  input: NewChaosInboxItemInput,
  options: {
    id?: string
    now?: string
    userId: string
    workspaceId: string
  },
): StoredChaosInboxItemRecord {
  const now = options.now ?? new Date().toISOString()

  return {
    convertedNoteId: null,
    convertedTaskId: null,
    createdAt: now,
    deletedAt: null,
    dueDate: null,
    id: input.id ?? options.id ?? generateUuidV7(),
    isFavorite: input.isFavorite ?? false,
    kind: input.kind ?? 'unknown',
    linkedTaskDeleted: false,
    priority: input.priority ?? null,
    shoppingCategory: input.shoppingCategory ?? null,
    source: input.source ?? 'manual',
    sphereId: null,
    status: 'new',
    text: input.text.trim(),
    updatedAt: now,
    userId: options.userId,
    version: 1,
    workspaceId: options.workspaceId,
  }
}
