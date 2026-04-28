import { beforeEach, describe, expect, it } from 'vitest'

import {
  clearLastActorUserId,
  clearSelectedWorkspaceId,
  getLastActorUserId,
  getSelectedWorkspaceId,
  setLastActorUserId,
  setSelectedWorkspaceId,
} from './workspace-selection'

describe('workspace-selection', () => {
  beforeEach(() => {
    window.localStorage.clear()
  })

  it('stores selected workspaces per actor', () => {
    setSelectedWorkspaceId('workspace-a', 'user-a')
    setSelectedWorkspaceId('workspace-b', 'user-b')

    expect(getSelectedWorkspaceId('user-a')).toBe('workspace-a')
    expect(getSelectedWorkspaceId('user-b')).toBe('workspace-b')
    expect(getSelectedWorkspaceId('user-c')).toBeNull()
  })

  it('clears the selected workspace only for the provided actor', () => {
    setSelectedWorkspaceId('workspace-a', 'user-a')
    setSelectedWorkspaceId('workspace-b', 'user-b')

    clearSelectedWorkspaceId('user-b')

    expect(getSelectedWorkspaceId('user-a')).toBe('workspace-a')
    expect(getSelectedWorkspaceId('user-b')).toBeNull()
  })

  it('clears the last actor user id', () => {
    setLastActorUserId('user-a')
    expect(getLastActorUserId()).toBe('user-a')

    clearLastActorUserId()

    expect(getLastActorUserId()).toBeNull()
  })
})
