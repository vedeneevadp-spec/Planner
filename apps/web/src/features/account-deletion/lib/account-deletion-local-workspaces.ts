interface OfflineStorageDescriptor {
  databaseName: string
  lifecycleStorageKeyPrefix: string
}

export async function discoverAccountDeletionOfflineWorkspaceIds(): Promise<
  string[]
> {
  try {
    const offlineStorages = await loadAccountDeletionOfflineStorages()
    const workspaceIds = readLifecycleWorkspaceIds(offlineStorages)
    const databaseWorkspaceIds = await Promise.all(
      offlineStorages.map(({ databaseName }) =>
        readDatabaseWorkspaceIds(databaseName),
      ),
    )

    for (const ids of databaseWorkspaceIds) {
      for (const workspaceId of ids) {
        workspaceIds.add(workspaceId)
      }
    }

    return [...workspaceIds].sort()
  } catch (error) {
    throw new AccountDeletionWorkspaceDiscoveryError(error)
  }
}

export class AccountDeletionWorkspaceDiscoveryError extends Error {
  constructor(cause: unknown) {
    super('Не удалось проверить локальные данные перед удалением аккаунта.', {
      cause,
    })
    this.name = 'AccountDeletionWorkspaceDiscoveryError'
  }
}

function readLifecycleWorkspaceIds(
  offlineStorages: readonly OfflineStorageDescriptor[],
): Set<string> {
  if (typeof window === 'undefined') {
    throw new Error('Browser storage is unavailable.')
  }

  const workspaceIds = new Set<string>()
  const storage = window.localStorage

  for (let index = 0; index < storage.length; index += 1) {
    const storageKey = storage.key(index)

    if (!storageKey) {
      continue
    }

    const descriptor = offlineStorages.find(({ lifecycleStorageKeyPrefix }) =>
      storageKey.startsWith(lifecycleStorageKeyPrefix),
    )

    if (!descriptor) {
      continue
    }

    const encodedWorkspaceId = storageKey.slice(
      descriptor.lifecycleStorageKeyPrefix.length,
    )

    if (!encodedWorkspaceId) {
      throw new Error('Offline lifecycle key has no workspace identifier.')
    }

    const workspaceId = decodeURIComponent(encodedWorkspaceId)

    if (!workspaceId) {
      throw new Error(
        'Offline lifecycle key has an empty workspace identifier.',
      )
    }

    workspaceIds.add(workspaceId)
  }

  return workspaceIds
}

async function loadAccountDeletionOfflineStorages(): Promise<
  readonly OfflineStorageDescriptor[]
> {
  const [cleaning, habits, planner, selfCare, shoppingList] = await Promise.all(
    [
      import('@/features/cleaning/offline-storage'),
      import('@/features/habits/offline-storage'),
      import('@/features/planner/offline-storage'),
      import('@/features/self-care/offline-storage'),
      import('@/features/shopping-list/offline-storage'),
    ],
  )

  return [
    {
      databaseName: cleaning.CLEANING_OFFLINE_DATABASE_NAME,
      lifecycleStorageKeyPrefix:
        cleaning.CLEANING_OFFLINE_LIFECYCLE_STORAGE_KEY_PREFIX,
    },
    {
      databaseName: habits.HABIT_OFFLINE_DATABASE_NAME,
      lifecycleStorageKeyPrefix:
        habits.HABIT_OFFLINE_LIFECYCLE_STORAGE_KEY_PREFIX,
    },
    {
      databaseName: planner.PLANNER_OFFLINE_DATABASE_NAME,
      lifecycleStorageKeyPrefix:
        planner.PLANNER_OFFLINE_LIFECYCLE_STORAGE_KEY_PREFIX,
    },
    {
      databaseName: selfCare.SELF_CARE_OFFLINE_DATABASE_NAME,
      lifecycleStorageKeyPrefix:
        selfCare.SELF_CARE_OFFLINE_LIFECYCLE_STORAGE_KEY_PREFIX,
    },
    {
      databaseName: shoppingList.SHOPPING_LIST_OFFLINE_DATABASE_NAME,
      lifecycleStorageKeyPrefix:
        shoppingList.SHOPPING_LIST_OFFLINE_LIFECYCLE_STORAGE_KEY_PREFIX,
    },
  ]
}

function readDatabaseWorkspaceIds(databaseName: string): Promise<Set<string>> {
  if (typeof indexedDB === 'undefined') {
    return Promise.reject(new Error('IndexedDB is unavailable.'))
  }

  return new Promise((resolve, reject) => {
    let openingAbsentDatabase = false
    let settled = false
    let request: IDBOpenDBRequest

    const resolveOnce = (workspaceIds: Set<string>) => {
      if (!settled) {
        settled = true
        resolve(workspaceIds)
      }
    }
    const rejectOnce = (error: Error) => {
      if (!settled) {
        settled = true
        reject(error)
      }
    }

    try {
      request = indexedDB.open(databaseName)
    } catch (error) {
      rejectOnce(toDiscoveryError(error))
      return
    }

    request.onupgradeneeded = (event) => {
      if (event.oldVersion !== 0) {
        return
      }

      openingAbsentDatabase = true
      request.transaction?.abort()
    }
    request.onerror = () => {
      if (openingAbsentDatabase && request.error?.name === 'AbortError') {
        resolveOnce(new Set())
        return
      }

      rejectOnce(
        request.error ?? new Error(`Failed to open IndexedDB ${databaseName}.`),
      )
    }
    request.onblocked = () => {
      rejectOnce(new Error(`Opening IndexedDB ${databaseName} was blocked.`))
    }
    request.onsuccess = () => {
      const database = request.result

      if (openingAbsentDatabase) {
        database.close()
        resolveOnce(new Set())
        return
      }

      readWorkspaceIdsFromOpenDatabase(database).then(resolveOnce, (error) => {
        rejectOnce(toDiscoveryError(error))
      })
    }
  })
}

function readWorkspaceIdsFromOpenDatabase(
  database: IDBDatabase,
): Promise<Set<string>> {
  const storeNames = Array.from(database.objectStoreNames)

  if (storeNames.length === 0) {
    database.close()
    return Promise.resolve(new Set())
  }

  return new Promise((resolve, reject) => {
    const workspaceIds = new Set<string>()
    let transaction: IDBTransaction

    try {
      transaction = database.transaction(storeNames, 'readonly')

      for (const storeName of storeNames) {
        const request = transaction.objectStore(storeName).openCursor()

        request.onsuccess = () => {
          const cursor = request.result

          if (!cursor) {
            return
          }

          const workspaceId = readWorkspaceId(cursor.value)

          if (workspaceId === null) {
            transaction.abort()
            return
          }

          if (workspaceId !== '__health__') {
            workspaceIds.add(workspaceId)
          }
          cursor.continue()
        }
      }
    } catch (error) {
      database.close()
      reject(toDiscoveryError(error))
      return
    }

    transaction.oncomplete = () => {
      database.close()
      resolve(workspaceIds)
    }
    transaction.onerror = () => {
      database.close()
      reject(
        transaction.error ??
          new Error(`Failed to inspect IndexedDB ${database.name}.`),
      )
    }
    transaction.onabort = () => {
      database.close()
      reject(
        transaction.error ??
          new Error(`IndexedDB ${database.name} contains an unscoped record.`),
      )
    }
  })
}

function readWorkspaceId(value: unknown): string | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null
  }

  const workspaceId = (value as Record<string, unknown>).workspaceId

  return typeof workspaceId === 'string' && workspaceId.length > 0
    ? workspaceId
    : null
}

function toDiscoveryError(error: unknown): Error {
  return error instanceof Error
    ? error
    : new Error('Offline workspace discovery failed.', { cause: error })
}
