import { useSyncExternalStore } from 'react'

const SELECTED_WORKSPACE_ID_KEY = 'planner.selectedWorkspaceId'
const LAST_ACTOR_USER_ID_KEY = 'planner.lastActorUserId'

type WorkspaceSelectionListener = () => void

const listeners = new Set<WorkspaceSelectionListener>()

export function getSelectedWorkspaceId(): string | null {
  return readStorageValue(SELECTED_WORKSPACE_ID_KEY)
}

export function setSelectedWorkspaceId(workspaceId: string): void {
  writeStorageValue(SELECTED_WORKSPACE_ID_KEY, workspaceId)
  emitWorkspaceSelectionChange()
}

export function clearSelectedWorkspaceId(): void {
  removeStorageValue(SELECTED_WORKSPACE_ID_KEY)
  emitWorkspaceSelectionChange()
}

export function getLastActorUserId(): string | null {
  return readStorageValue(LAST_ACTOR_USER_ID_KEY)
}

export function setLastActorUserId(actorUserId: string): void {
  writeStorageValue(LAST_ACTOR_USER_ID_KEY, actorUserId)
}

export function useSelectedWorkspaceId(): string | null {
  return useSyncExternalStore(
    subscribeWorkspaceSelection,
    getSelectedWorkspaceId,
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
