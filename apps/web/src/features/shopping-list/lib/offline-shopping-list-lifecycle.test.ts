import 'fake-indexeddb/auto'

import { afterEach, beforeEach, expect, it, vi } from 'vitest'

import { assertOfflineMutationsSettled } from '@/shared/lib/offline-sync'

import * as shoppingStore from './offline-shopping-list-store'
import {
  clearShoppingListOfflineWorkspaceData,
  enqueueShoppingListOfflineMutation,
  listRetryableShoppingListOfflineMutations,
  resetShoppingListOfflineDatabaseForTests,
  resetShoppingListOfflineRuntimeForTests,
} from './offline-shopping-list-store'
import { drainShoppingListOfflineQueue } from './offline-shopping-list-sync'
import type { ShoppingListApiClient } from './shopping-list-api'

beforeEach(async () => {
  await resetShoppingListOfflineDatabaseForTests()
})
afterEach(() => vi.restoreAllMocks())

function deferred() {
  let resolve!: () => void
  let reject!: (error: Error) => void
  const promise = new Promise<void>((yes, no) => {
    resolve = yes
    reject = no
  })
  return { promise, resolve, reject }
}

async function queueDeletes(workspaceId: string) {
  for (const itemId of ['first', 'second']) {
    await enqueueShoppingListOfflineMutation({
      workspaceId,
      actorUserId: 'actor',
      itemId,
      type: 'shopping.delete',
    })
  }
}

it('waits the sent write and never sends the next command or callback after purge', async () => {
  const workspaceId = 'purge-regression'
  await queueDeletes(workspaceId)
  const started = deferred()
  const response = deferred()
  const removeItem = vi.fn(async () => {
    started.resolve()
    await response.promise
  })
  const onItemDeleted = vi.fn()
  const drain = drainShoppingListOfflineQueue({
    workspaceId,
    actorUserId: 'actor',
    api: { removeItem } as unknown as ShoppingListApiClient,
    onItemDeleted,
  })
  await started.promise
  let cleared = false
  const clearing = clearShoppingListOfflineWorkspaceData(workspaceId).then(
    () => {
      cleared = true
    },
  )
  await Promise.resolve()
  expect(cleared).toBe(false)
  response.resolve()
  await Promise.all([clearing, drain])
  expect(removeItem).toHaveBeenCalledTimes(1)
  expect(onItemDeleted).not.toHaveBeenCalled()
  expect(await listRetryableShoppingListOfflineMutations(workspaceId)).toEqual(
    [],
  )
})

it('preserves uncertain commands for replay instead of deleting them before restore', async () => {
  const workspaceId = 'uncertain-purge-regression'
  await queueDeletes(workspaceId)
  const started = deferred()
  const response = deferred()
  const removeItem = vi.fn(async () => {
    started.resolve()
    await response.promise
  })
  const drain = drainShoppingListOfflineQueue({
    workspaceId,
    actorUserId: 'actor',
    api: { removeItem } as unknown as ShoppingListApiClient,
  })
  await started.promise
  const clearing = clearShoppingListOfflineWorkspaceData(workspaceId)
  const rejected = expect(clearing).rejects.toThrow(
    'Не подтверждено завершение синхронизации',
  )
  response.reject(new TypeError('Network lost after send'))
  await Promise.all([drain, rejected])
  expect(() => assertOfflineMutationsSettled(workspaceId)).toThrow()
  // Reload acknowledges the new lifecycle generation, without deleting commands.
  resetShoppingListOfflineRuntimeForTests()
  expect(
    await listRetryableShoppingListOfflineMutations(workspaceId),
  ).toHaveLength(2)
  const retry = vi.fn().mockResolvedValue(undefined)
  await drainShoppingListOfflineQueue({
    workspaceId,
    actorUserId: 'actor',
    api: { removeItem: retry } as unknown as ShoppingListApiClient,
  })
  expect(retry).toHaveBeenCalledTimes(2)
  expect(() => assertOfflineMutationsSettled(workspaceId)).not.toThrow()
})

it('suppresses callbacks when purge starts during the final cache write', async () => {
  const workspaceId = 'purge-during-cache-write'
  await queueDeletes(workspaceId)
  const entered = deferred()
  const release = deferred()
  vi.spyOn(shoppingStore, 'removeCachedShoppingListItem').mockImplementation(
    async () => {
      entered.resolve()
      await release.promise
    },
  )
  const onItemDeleted = vi.fn()
  const removeItem = vi.fn().mockResolvedValue(undefined)
  const drain = drainShoppingListOfflineQueue({
    workspaceId,
    actorUserId: 'actor',
    api: { removeItem } as unknown as ShoppingListApiClient,
    onItemDeleted,
  })
  await entered.promise
  const clear = clearShoppingListOfflineWorkspaceData(workspaceId)
  release.resolve()
  await Promise.all([clear, drain])
  expect(onItemDeleted).not.toHaveBeenCalled()
  expect(removeItem).toHaveBeenCalledTimes(1)
})
