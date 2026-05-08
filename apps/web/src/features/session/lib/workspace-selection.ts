import { useSyncExternalStore } from 'react'

const LEGACY_SELECTED_WORKSPACE_ID_KEY = 'planner.selectedWorkspaceId'
const SELECTED_WORKSPACE_IDS_KEY = 'planner.selectedWorkspaceIds'
const LAST_ACTOR_USER_ID_KEY = 'planner.lastActorUserId'

type WorkspaceSelectionListener = () => void
type SelectedWorkspaceIdMap = Record<string, string>

const listeners = new Set<WorkspaceSelectionListener>()

export function getSelectedWorkspaceId(
  actorUserId?: string | null,
): string | null {
  const normalizedActorUserId = normalizeActorUserId(actorUserId)

  if (!normalizedActorUserId) {
    return null
  }

  const map = readSelectedWorkspaceIdMap()
  const value = map[normalizedActorUserId]?.trim()

  return value || null
}

export function setSelectedWorkspaceId(
  workspaceId: string,
  actorUserId?: string | null,
): void {
  const normalizedActorUserId = normalizeActorUserId(actorUserId)

  if (!normalizedActorUserId) {
    return
  }

  const nextMap = readSelectedWorkspaceIdMap()
  nextMap[normalizedActorUserId] = workspaceId
  writeSelectedWorkspaceIdMap(nextMap)
  removeStorageValue(LEGACY_SELECTED_WORKSPACE_ID_KEY)
  emitWorkspaceSelectionChange()
}

export function setSelectedWorkspaceIdForActors(
  workspaceId: string,
  actorUserIds: Array<string | null | undefined>,
): void {
  const normalizedActorUserIds = Array.from(
    new Set(
      actorUserIds
        .map((actorUserId) => normalizeActorUserId(actorUserId))
        .filter((actorUserId): actorUserId is string => Boolean(actorUserId)),
    ),
  )

  if (normalizedActorUserIds.length === 0) {
    return
  }

  const nextMap = readSelectedWorkspaceIdMap()

  for (const actorUserId of normalizedActorUserIds) {
    nextMap[actorUserId] = workspaceId
  }

  writeSelectedWorkspaceIdMap(nextMap)
  removeStorageValue(LEGACY_SELECTED_WORKSPACE_ID_KEY)
  emitWorkspaceSelectionChange()
}

export function clearSelectedWorkspaceId(actorUserId?: string | null): void {
  const normalizedActorUserId = normalizeActorUserId(actorUserId)

  if (normalizedActorUserId) {
    const nextMap = readSelectedWorkspaceIdMap()
    delete nextMap[normalizedActorUserId]
    writeSelectedWorkspaceIdMap(nextMap)
  }

  removeStorageValue(LEGACY_SELECTED_WORKSPACE_ID_KEY)
  emitWorkspaceSelectionChange()
}

export function getLastActorUserId(): string | null {
  return readStorageValue(LAST_ACTOR_USER_ID_KEY)
}

export function setLastActorUserId(actorUserId: string): void {
  writeStorageValue(LAST_ACTOR_USER_ID_KEY, actorUserId)
}

export function clearLastActorUserId(): void {
  removeStorageValue(LAST_ACTOR_USER_ID_KEY)
}

export function useSelectedWorkspaceId(
  actorUserId?: string | null,
): string | null {
  return useSyncExternalStore(
    subscribeWorkspaceSelection,
    () => getSelectedWorkspaceId(actorUserId),
    () => null,
  )
}

function subscribeWorkspaceSelection(
  listener: WorkspaceSelectionListener,
): () => void {
  listeners.add(listener)

  return () => {
    listeners.delete(listener)
  }
}

function emitWorkspaceSelectionChange(): void {
  for (const listener of listeners) {
    listener()
  }
}

function normalizeActorUserId(actorUserId?: string | null): string | null {
  return actorUserId?.trim() || null
}

function readSelectedWorkspaceIdMap(): SelectedWorkspaceIdMap {
  const rawValue = readStorageValue(SELECTED_WORKSPACE_IDS_KEY)

  if (!rawValue) {
    return {}
  }

  try {
    const parsedValue = JSON.parse(rawValue) as unknown

    if (
      !parsedValue ||
      typeof parsedValue !== 'object' ||
      Array.isArray(parsedValue)
    ) {
      return {}
    }

    const nextMap: SelectedWorkspaceIdMap = {}

    for (const [key, value] of Object.entries(parsedValue)) {
      if (typeof value !== 'string') {
        continue
      }

      const normalizedKey = key.trim()
      const normalizedValue = value.trim()

      if (!normalizedKey || !normalizedValue) {
        continue
      }

      nextMap[normalizedKey] = normalizedValue
    }

    return nextMap
  } catch {
    return {}
  }
}

function writeSelectedWorkspaceIdMap(map: SelectedWorkspaceIdMap): void {
  if (Object.keys(map).length === 0) {
    removeStorageValue(SELECTED_WORKSPACE_IDS_KEY)
    return
  }

  writeStorageValue(SELECTED_WORKSPACE_IDS_KEY, JSON.stringify(map))
}

function readStorageValue(key: string): string | null {
  if (typeof window === 'undefined') {
    return null
  }

  const value = window.localStorage.getItem(key)?.trim()

  return value || null
}

function writeStorageValue(key: string, value: string): void {
  if (typeof window === 'undefined') {
    return
  }

  window.localStorage.setItem(key, value)
}

function removeStorageValue(key: string): void {
  if (typeof window === 'undefined') {
    return
  }

  window.localStorage.removeItem(key)
}
