import { beforeEach, describe, expect, it, vi } from 'vitest'

import {
  applyWorkspaceLocalDataInvalidation,
  broadcastWorkspaceLocalDataInvalidation,
  WORKSPACE_LOCAL_DATA_INVALIDATION_STORAGE_KEY,
  WorkspaceLocalDataInvalidationUnavailableError,
} from './workspace-local-data-invalidation'

describe('workspace local data invalidation', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    window.localStorage.clear()
    window.sessionStorage.clear()
    window.history.replaceState(null, document.title)
  })

  it('persists a read-back-verified cross-tab event and acknowledges it locally', () => {
    broadcastWorkspaceLocalDataInvalidation('workspace-1', 'backup-restore')
    const rawValue = window.localStorage.getItem(
      WORKSPACE_LOCAL_DATA_INVALIDATION_STORAGE_KEY,
    )
    const reloadPage = vi.fn()

    expect(rawValue).toContain('workspace-1')
    expect(applyWorkspaceLocalDataInvalidation(rawValue, { reloadPage })).toBe(
      false,
    )
    expect(reloadPage).not.toHaveBeenCalled()
  })

  it('reloads another tab once for a new storage event', () => {
    const rawValue = JSON.stringify({
      eventId: 'event-from-another-tab',
      occurredAt: Date.now(),
      reason: 'session-cleared',
      workspaceId: 'workspace-1',
    })
    const reloadPage = vi.fn()

    expect(applyWorkspaceLocalDataInvalidation(rawValue, { reloadPage })).toBe(
      true,
    )
    expect(applyWorkspaceLocalDataInvalidation(rawValue, { reloadPage })).toBe(
      false,
    )
    expect(reloadPage).toHaveBeenCalledTimes(1)
  })

  it('recovers a recent event missed while the other tab was reloading', () => {
    const rawValue = JSON.stringify({
      eventId: 'missed-during-reload',
      occurredAt: 2_000,
      reason: 'backup-restore',
      workspaceId: 'workspace-1',
    })
    const reloadPage = vi.fn()

    expect(
      applyWorkspaceLocalDataInvalidation(rawValue, {
        ignoreEventsOlderThan: 1_000,
        reloadPage,
      }),
    ).toBe(true)
    expect(reloadPage).toHaveBeenCalledTimes(1)
  })

  it('fails closed when the invalidation event cannot be persisted', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => undefined)

    expect(() =>
      broadcastWorkspaceLocalDataInvalidation('workspace-1', 'backup-restore'),
    ).toThrow(WorkspaceLocalDataInvalidationUnavailableError)
  })

  it('does not enter a boot reload loop when per-tab acknowledgement is unavailable', () => {
    vi.spyOn(window.sessionStorage, 'setItem').mockImplementation(() => {
      throw new DOMException('Session storage blocked', 'SecurityError')
    })
    vi.spyOn(History.prototype, 'replaceState').mockImplementation(() => {
      throw new DOMException('History state blocked', 'SecurityError')
    })
    const rawValue = JSON.stringify({
      eventId: 'cannot-be-acknowledged',
      occurredAt: 2_000,
      reason: 'backup-restore',
      workspaceId: 'workspace-1',
    })
    const reloadPage = vi.fn()

    expect(applyWorkspaceLocalDataInvalidation(rawValue, { reloadPage })).toBe(
      true,
    )
    expect(
      applyWorkspaceLocalDataInvalidation(rawValue, {
        ignoreEventsOlderThan: 1_000,
        reloadPage,
      }),
    ).toBe(false)
    expect(reloadPage).toHaveBeenCalledTimes(1)
  })
})
