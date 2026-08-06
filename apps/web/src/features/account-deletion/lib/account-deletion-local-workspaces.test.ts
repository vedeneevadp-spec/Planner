import 'fake-indexeddb/auto'

import Dexie from 'dexie'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  CLEANING_OFFLINE_DATABASE_NAME,
  CLEANING_OFFLINE_LIFECYCLE_STORAGE_KEY_PREFIX,
} from '@/features/cleaning'
import {
  HABIT_OFFLINE_DATABASE_NAME,
  HABIT_OFFLINE_LIFECYCLE_STORAGE_KEY_PREFIX,
} from '@/features/habits'
import {
  PLANNER_OFFLINE_DATABASE_NAME,
  PLANNER_OFFLINE_LIFECYCLE_STORAGE_KEY_PREFIX,
} from '@/features/planner'
import {
  SELF_CARE_OFFLINE_DATABASE_NAME,
  SELF_CARE_OFFLINE_LIFECYCLE_STORAGE_KEY_PREFIX,
} from '@/features/self-care'
import {
  SHOPPING_LIST_OFFLINE_DATABASE_NAME,
  SHOPPING_LIST_OFFLINE_LIFECYCLE_STORAGE_KEY_PREFIX,
} from '@/features/shopping-list'

import {
  AccountDeletionWorkspaceDiscoveryError,
  discoverAccountDeletionOfflineWorkspaceIds,
} from './account-deletion-local-workspaces'

const DATABASE_NAMES = [
  CLEANING_OFFLINE_DATABASE_NAME,
  HABIT_OFFLINE_DATABASE_NAME,
  PLANNER_OFFLINE_DATABASE_NAME,
  SELF_CARE_OFFLINE_DATABASE_NAME,
  SHOPPING_LIST_OFFLINE_DATABASE_NAME,
] as const

const LIFECYCLE_PREFIXES = [
  CLEANING_OFFLINE_LIFECYCLE_STORAGE_KEY_PREFIX,
  HABIT_OFFLINE_LIFECYCLE_STORAGE_KEY_PREFIX,
  PLANNER_OFFLINE_LIFECYCLE_STORAGE_KEY_PREFIX,
  SELF_CARE_OFFLINE_LIFECYCLE_STORAGE_KEY_PREFIX,
  SHOPPING_LIST_OFFLINE_LIFECYCLE_STORAGE_KEY_PREFIX,
] as const

describe('account deletion local workspace discovery', () => {
  beforeEach(async () => {
    window.localStorage.clear()
    await deleteKnownDatabases()
  })

  afterEach(async () => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
    window.localStorage.clear()
    await deleteKnownDatabases()
  })

  it('discovers stale workspace records from every known offline database', async () => {
    await Promise.all(
      DATABASE_NAMES.map((databaseName, index) =>
        createWorkspaceDatabase(
          databaseName,
          `database-workspace-${index + 1}`,
        ),
      ),
    )

    await expect(discoverAccountDeletionOfflineWorkspaceIds()).resolves.toEqual(
      DATABASE_NAMES.map((_, index) => `database-workspace-${index + 1}`),
    )
  })

  it('discovers workspace ids encoded in every lifecycle key prefix', async () => {
    for (const [index, prefix] of LIFECYCLE_PREFIXES.entries()) {
      const workspaceId = `lifecycle workspace/${index + 1}`
      window.localStorage.setItem(
        `${prefix}${encodeURIComponent(workspaceId)}`,
        '{}',
      )
    }

    await expect(discoverAccountDeletionOfflineWorkspaceIds()).resolves.toEqual(
      LIFECYCLE_PREFIXES.map((_, index) => `lifecycle workspace/${index + 1}`),
    )
  })

  it('does not leave empty databases behind while checking absent stores', async () => {
    await expect(discoverAccountDeletionOfflineWorkspaceIds()).resolves.toEqual(
      [],
    )

    const existingDatabaseNames = (await indexedDB.databases()).flatMap(
      ({ name }) => (name ? [name] : []),
    )
    expect(
      existingDatabaseNames.filter((name) =>
        (DATABASE_NAMES as readonly string[]).includes(name),
      ),
    ).toEqual([])
  })

  it('rejects discovery rather than ignoring an unscoped offline record', async () => {
    await createWorkspaceDatabase(CLEANING_OFFLINE_DATABASE_NAME, null)

    await expect(
      discoverAccountDeletionOfflineWorkspaceIds(),
    ).rejects.toBeInstanceOf(AccountDeletionWorkspaceDiscoveryError)
  })

  it('rejects discovery when IndexedDB cannot be inspected', async () => {
    vi.stubGlobal('indexedDB', undefined)

    await expect(
      discoverAccountDeletionOfflineWorkspaceIds(),
    ).rejects.toBeInstanceOf(AccountDeletionWorkspaceDiscoveryError)
  })

  it('rejects discovery when opening an offline database fails', async () => {
    vi.spyOn(IDBFactory.prototype, 'open').mockImplementation(() => {
      throw new DOMException('Database access denied', 'SecurityError')
    })

    await expect(
      discoverAccountDeletionOfflineWorkspaceIds(),
    ).rejects.toBeInstanceOf(AccountDeletionWorkspaceDiscoveryError)
  })

  it('rejects discovery when lifecycle storage cannot be enumerated', async () => {
    window.localStorage.setItem('unrelated-key', 'value')
    vi.spyOn(Storage.prototype, 'key').mockImplementation(() => {
      throw new DOMException('Storage denied', 'SecurityError')
    })

    await expect(
      discoverAccountDeletionOfflineWorkspaceIds(),
    ).rejects.toBeInstanceOf(AccountDeletionWorkspaceDiscoveryError)
  })
})

async function createWorkspaceDatabase(
  databaseName: string,
  workspaceId: string | null,
): Promise<void> {
  const database = new Dexie(databaseName)
  database.version(1).stores({ records: 'id, workspaceId' })
  await database.open()
  await database.table('records').put({
    id: `record-${databaseName}`,
    ...(workspaceId === null ? {} : { workspaceId }),
  })
  database.close()
}

async function deleteKnownDatabases(): Promise<void> {
  await Promise.all(
    DATABASE_NAMES.map((databaseName) => Dexie.delete(databaseName)),
  )
}
