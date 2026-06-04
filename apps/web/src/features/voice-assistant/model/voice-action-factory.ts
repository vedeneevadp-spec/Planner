import {
  generateUuidV7,
  type PlannerIntent,
  type VoiceActionAgendaItem,
  type VoiceActionCandidate,
  type VoiceActionContext,
  type VoiceActionPreview,
  voiceActionPreviewSchema,
  type VoiceActionResult,
  voiceActionResultSchema,
  type VoiceActionShoppingItem,
  type VoiceActionUndo,
} from '@planner/contracts'

export function createPreview(
  intent: PlannerIntent,
  input: {
    agendaItems?: VoiceActionAgendaItem[] | undefined
    candidates?: VoiceActionCandidate[] | undefined
    canExecute: boolean
    context: VoiceActionContext
    isOffline?: boolean | undefined
    isStale?: boolean | undefined
    needsConfirmation?: boolean | undefined
    reason?: string | undefined
    requiresUnlock?: boolean | undefined
    shoppingItems?: VoiceActionShoppingItem[] | undefined
    status?: VoiceActionPreview['status'] | undefined
    summary: string
    title: string
  },
): VoiceActionPreview {
  return voiceActionPreviewSchema.parse({
    agendaItems: input.agendaItems,
    candidates: input.candidates,
    canExecute: input.canExecute,
    id: generateUuidV7(),
    intent,
    isDangerous: intent.isDangerous ?? intent.intent === 'reschedule_task',
    isOffline: input.isOffline,
    isStale: input.isStale,
    needsConfirmation: input.needsConfirmation ?? true,
    reason: input.reason,
    requiresUnlock: input.requiresUnlock ?? false,
    shoppingItems: input.shoppingItems,
    status: input.status ?? 'ready_for_confirmation',
    summary: input.summary,
    title: input.title,
    type: intent.intent,
  })
}

export function createResult(input: {
  changedData?: boolean | undefined
  createdShoppingItemIds?: string[] | undefined
  createdTaskId?: string | undefined
  errorCode?: string | undefined
  status: VoiceActionResult['status']
  undo?: VoiceActionUndo | undefined
  updatedTaskId?: string | undefined
  visualStatus: string
}): VoiceActionResult {
  return voiceActionResultSchema.parse(createDefinedObject(input))
}

export function getRecordId(value: unknown): string | undefined {
  if (!value || typeof value !== 'object') {
    return undefined
  }

  const id = (value as { id?: unknown }).id

  return typeof id === 'string' ? id : undefined
}

export function getErrorCode(error: unknown): string | undefined {
  if (!error || typeof error !== 'object') {
    return undefined
  }

  const code = (error as { code?: unknown }).code

  return typeof code === 'string' ? code : undefined
}

function createDefinedObject<T extends Record<string, unknown>>(value: T): T {
  return Object.fromEntries(
    Object.entries(value).filter((entry) => entry[1] !== undefined),
  ) as T
}
