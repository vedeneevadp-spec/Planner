import {
  generateUuidV7,
  type NewChaosInboxItemInput,
  type NewTaskInput,
} from '@planner/contracts'

import { HttpError } from '../../bootstrap/http-error.js'
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
    activatedAt: now,
    completedAt: null,
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
    productUrl: input.productUrl ?? null,
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

export function resolveShoppingCreateReplay(
  existing: StoredChaosInboxItemRecord | undefined,
  input: NewChaosInboxItemInput,
  actorUserId: string,
  workspaceId: string,
): StoredChaosInboxItemRecord {
  if (
    !existing ||
    existing.deletedAt !== null ||
    existing.userId !== actorUserId ||
    existing.workspaceId !== workspaceId ||
    existing.kind !== 'shopping' ||
    input.kind !== 'shopping' ||
    existing.text !== input.text.trim() ||
    (existing.productUrl ?? null) !== (input.productUrl ?? null)
  ) {
    throw new HttpError(
      409,
      'chaos_inbox_id_conflict',
      'Inbox item id is already in use.',
    )
  }
  return existing
}

export function buildChaosInboxTaskInput(
  item: StoredChaosInboxItemRecord,
  taskId = generateUuidV7(),
): NewTaskInput {
  return {
    assigneeUserId: null,
    dueDate: item.dueDate,
    icon: '',
    id: taskId,
    importance: item.priority === 'high' ? 'important' : 'not_important',
    necessity: 'desired',
    note: '',
    plannedDate: item.dueDate,
    plannedEndTime: null,
    plannedStartTime: null,
    project: '',
    projectId: item.sphereId,
    resource: item.priority === 'high' ? 3 : item.priority === 'low' ? 1 : 2,
    requiresConfirmation: false,
    sphereId: item.sphereId,
    title: item.text,
    urgency: item.priority === 'high' ? 'urgent' : 'not_urgent',
  }
}
