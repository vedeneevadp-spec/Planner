import { afterEach, expect, it, vi } from 'vitest'

import {
  assertOfflineMutationsSettled,
  trackOfflineMutation,
} from './workspace-mutation-lock'

afterEach(() => vi.restoreAllMocks())

it('persists a fence before dispatch, including a page closing before its response', async () => {
  const workspaceId = 'before-dispatch'
  let release!: () => void
  const response = new Promise<void>((resolve) => {
    release = resolve
  })
  const write = trackOfflineMutation(workspaceId, 'operation-1', () => {
    expect(
      localStorage.getItem(
        'planner.uncertain-offline-mutation:before-dispatch:operation-1',
      ),
    ).toBe('1')
    return response
  })
  expect(() => assertOfflineMutationsSettled(workspaceId)).toThrow()
  release()
  await write
  expect(() => assertOfflineMutationsSettled(workspaceId)).not.toThrow()
})

it('honors a durable fence left by an earlier page until the same command settles', async () => {
  const workspaceId = 'earlier-page'
  localStorage.setItem(
    'planner.uncertain-offline-mutation:earlier-page:operation-1',
    '1',
  )
  expect(() => assertOfflineMutationsSettled(workspaceId)).toThrow()
  await trackOfflineMutation(workspaceId, 'operation-1', () =>
    Promise.resolve(),
  )
  expect(() => assertOfflineMutationsSettled(workspaceId)).not.toThrow()
})

it('does not dispatch a write when its durable fence cannot be saved', async () => {
  vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
    throw new Error('Storage blocked')
  })
  const run = vi.fn(() => Promise.resolve())
  await expect(
    trackOfflineMutation('storage-blocked', 'operation-1', run),
  ).rejects.toThrow()
  expect(run).not.toHaveBeenCalled()
})
