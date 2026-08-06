import { generateUuidV7 } from '@planner/contracts'

export type WorkspaceLocalDataInvalidationReason =
  'account-deletion' | 'backup-restore'

interface WorkspaceLocalDataInvalidationEvent {
  eventId: string
  occurredAt: number
  reason: WorkspaceLocalDataInvalidationReason
  workspaceId: string
}

export const WORKSPACE_LOCAL_DATA_INVALIDATION_STORAGE_KEY =
  'planner.workspaceLocalDataInvalidation'
const WORKSPACE_LOCAL_DATA_INVALIDATION_ACK_KEY =
  'planner.workspaceLocalDataInvalidation.acknowledged'
const WORKSPACE_LOCAL_DATA_INVALIDATION_HISTORY_STATE_KEY =
  'plannerWorkspaceLocalDataInvalidationAcknowledged'
const WORKSPACE_LOCAL_DATA_INVALIDATION_BOOT_MAX_AGE_MS = 5 * 60 * 1000

let isWorkspaceLocalDataInvalidationListenerRegistered = false

export class WorkspaceLocalDataInvalidationUnavailableError extends Error {
  readonly code = 'workspace_local_data_invalidation_unavailable'

  constructor(cause?: unknown) {
    super('Не удалось обновить данные в других вкладках.', { cause })
    this.name = 'WorkspaceLocalDataInvalidationUnavailableError'
  }
}

export function broadcastWorkspaceLocalDataInvalidation(
  workspaceId: string,
  reason: WorkspaceLocalDataInvalidationReason,
): void {
  if (typeof window === 'undefined') {
    throw new WorkspaceLocalDataInvalidationUnavailableError()
  }

  const event = {
    eventId: generateUuidV7(),
    occurredAt: Date.now(),
    reason,
    workspaceId,
  } satisfies WorkspaceLocalDataInvalidationEvent
  const serialized = JSON.stringify(event)

  try {
    acknowledgeWorkspaceLocalDataInvalidation(event.eventId)
    window.localStorage.setItem(
      WORKSPACE_LOCAL_DATA_INVALIDATION_STORAGE_KEY,
      serialized,
    )

    if (
      window.localStorage.getItem(
        WORKSPACE_LOCAL_DATA_INVALIDATION_STORAGE_KEY,
      ) !== serialized
    ) {
      throw new WorkspaceLocalDataInvalidationUnavailableError()
    }
  } catch (error) {
    if (error instanceof WorkspaceLocalDataInvalidationUnavailableError) {
      throw error
    }

    throw new WorkspaceLocalDataInvalidationUnavailableError(error)
  }
}

export function registerWorkspaceLocalDataInvalidationListener(): boolean {
  if (
    typeof window === 'undefined' ||
    isWorkspaceLocalDataInvalidationListenerRegistered
  ) {
    return false
  }

  window.addEventListener('storage', (event) => {
    if (event.key !== WORKSPACE_LOCAL_DATA_INVALIDATION_STORAGE_KEY) {
      return
    }

    applyWorkspaceLocalDataInvalidation(event.newValue, {
      reloadPage: () => window.location.reload(),
    })
  })
  isWorkspaceLocalDataInvalidationListenerRegistered = true

  try {
    return applyWorkspaceLocalDataInvalidation(
      window.localStorage.getItem(
        WORKSPACE_LOCAL_DATA_INVALIDATION_STORAGE_KEY,
      ),
      {
        ignoreEventsOlderThan:
          Date.now() - WORKSPACE_LOCAL_DATA_INVALIDATION_BOOT_MAX_AGE_MS,
        reloadPage: () => window.location.reload(),
      },
    )
  } catch {
    return false
  }
}

export function applyWorkspaceLocalDataInvalidation(
  rawValue: string | null,
  options: {
    ignoreEventsOlderThan?: number | undefined
    reloadPage: () => void
  },
): boolean {
  const event = parseWorkspaceLocalDataInvalidationEvent(rawValue)

  if (
    !event ||
    (options.ignoreEventsOlderThan !== undefined &&
      event.occurredAt < options.ignoreEventsOlderThan) ||
    readAcknowledgedWorkspaceLocalDataInvalidation() === event.eventId
  ) {
    return false
  }

  const wasAcknowledged = acknowledgeWorkspaceLocalDataInvalidation(
    event.eventId,
  )

  if (!wasAcknowledged && options.ignoreEventsOlderThan !== undefined) {
    return false
  }

  options.reloadPage()
  return true
}

function parseWorkspaceLocalDataInvalidationEvent(
  rawValue: string | null,
): WorkspaceLocalDataInvalidationEvent | null {
  if (!rawValue) {
    return null
  }

  try {
    const parsed = JSON.parse(rawValue) as unknown

    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return null
    }

    const value = parsed as Record<string, unknown>
    const eventId = value.eventId
    const occurredAt = value.occurredAt
    const reason = value.reason
    const workspaceId = value.workspaceId

    if (
      typeof eventId !== 'string' ||
      eventId.length === 0 ||
      typeof occurredAt !== 'number' ||
      !Number.isFinite(occurredAt) ||
      (reason !== 'account-deletion' && reason !== 'backup-restore') ||
      typeof workspaceId !== 'string' ||
      workspaceId.length === 0
    ) {
      return null
    }

    return { eventId, occurredAt, reason, workspaceId }
  } catch {
    return null
  }
}

function acknowledgeWorkspaceLocalDataInvalidation(eventId: string): boolean {
  try {
    window.sessionStorage.setItem(
      WORKSPACE_LOCAL_DATA_INVALIDATION_ACK_KEY,
      eventId,
    )

    if (
      window.sessionStorage.getItem(
        WORKSPACE_LOCAL_DATA_INVALIDATION_ACK_KEY,
      ) === eventId
    ) {
      return true
    }
  } catch {
    // Fall through to the per-tab history state when sessionStorage is blocked.
  }

  try {
    const currentState = readHistoryState()
    window.history.replaceState(
      {
        ...currentState,
        [WORKSPACE_LOCAL_DATA_INVALIDATION_HISTORY_STATE_KEY]: eventId,
      },
      document.title,
    )

    return readAcknowledgedWorkspaceLocalDataInvalidation() === eventId
  } catch {
    return false
  }
}

function readAcknowledgedWorkspaceLocalDataInvalidation(): string | null {
  try {
    const acknowledgedEventId = window.sessionStorage.getItem(
      WORKSPACE_LOCAL_DATA_INVALIDATION_ACK_KEY,
    )

    if (acknowledgedEventId) {
      return acknowledgedEventId
    }
  } catch {
    // Fall through to the per-tab history state when sessionStorage is blocked.
  }

  const historyAcknowledgement =
    readHistoryState()[WORKSPACE_LOCAL_DATA_INVALIDATION_HISTORY_STATE_KEY]

  return typeof historyAcknowledgement === 'string'
    ? historyAcknowledgement
    : null
}

function readHistoryState(): Record<string, unknown> {
  const state = window.history.state as unknown

  return state && typeof state === 'object' && !Array.isArray(state)
    ? (state as Record<string, unknown>)
    : {}
}
