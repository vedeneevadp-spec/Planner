import type { ChaosInboxItemRecord } from '@planner/contracts'
import { cleanup, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { ShoppingPage } from './ShoppingPage'

const mocks = vi.hoisted(() => ({
  useShoppingListSummary: vi.fn(),
  useShoppingListSyncStatus: vi.fn(),
}))

vi.mock('@/features/shopping-list', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>()

  return {
    ...actual,
    useCreateShoppingListItem: () => ({
      error: null,
      isPending: false,
      mutateAsync: vi.fn(),
    }),
    useRemoveShoppingListItem: () => ({
      error: null,
      isPending: false,
      mutateAsync: vi.fn(),
    }),
    useShoppingListSummary: mocks.useShoppingListSummary,
    useShoppingListSyncStatus: mocks.useShoppingListSyncStatus,
    useUpdateShoppingListItem: () => ({
      error: null,
      isPending: false,
      mutateAsync: vi.fn(),
    }),
  }
})

describe('ShoppingPage', () => {
  beforeEach(() => {
    mocks.useShoppingListSummary.mockReturnValue({
      activeItems: [],
      completedItems: [],
      error: null,
      isLoading: false,
    })
    mocks.useShoppingListSyncStatus.mockReturnValue({
      conflictedMutationCount: 0,
      error: null,
      isPending: false,
      isSyncing: false,
      queuedMutationCount: 0,
      retry: vi.fn(),
    })
  })

  afterEach(() => {
    cleanup()
  })

  it('shows a local sync message instead of raw session readiness errors', () => {
    mocks.useShoppingListSummary.mockReturnValue({
      activeItems: [],
      completedItems: [],
      error: new Error(
        'Planner session is required to load shopping list items.',
      ),
      isLoading: false,
    })

    renderShoppingPage('/shopping')

    expect(
      screen.getByText(
        'Нет соединения. Изменения сохранятся локально и синхронизируются автоматически.',
      ),
    ).toBeVisible()
  })

  it('filters items from the shopping query parameters', () => {
    mocks.useShoppingListSummary.mockReturnValue({
      activeItems: [
        createShoppingItem({
          id: 'item-1',
          shoppingCategory: 'groceries',
          text: 'Молоко',
        }),
        createShoppingItem({
          id: 'item-2',
          shoppingCategory: 'household',
          text: 'Губки',
        }),
      ],
      completedItems: [],
      error: null,
      isLoading: false,
    })

    renderShoppingPage('/shopping?shoppingCategory=groceries')

    expect(screen.getByText('Молоко')).toBeVisible()
    expect(screen.queryByText('Губки')).not.toBeInTheDocument()
  })

  it('shows offline queue health when shopping mutations are pending or conflicted', () => {
    mocks.useShoppingListSyncStatus.mockReturnValue({
      conflictedMutationCount: 1,
      error: null,
      isPending: false,
      isSyncing: false,
      queuedMutationCount: 2,
      retry: vi.fn(),
    })

    renderShoppingPage('/shopping')

    expect(screen.getByText('Есть конфликтующие покупки')).toBeVisible()
    expect(
      screen.getByText('2 ждут синхронизации, конфликтов: 1'),
    ).toBeVisible()
  })
})

function renderShoppingPage(initialEntry: string) {
  return render(
    <MemoryRouter initialEntries={[initialEntry]}>
      <ShoppingPage />
    </MemoryRouter>,
  )
}

function createShoppingItem(
  item: Pick<ChaosInboxItemRecord, 'id' | 'text'> &
    Partial<ChaosInboxItemRecord>,
): ChaosInboxItemRecord {
  const { id, text, ...overrides } = item

  return {
    convertedNoteId: null,
    convertedTaskId: null,
    createdAt: '2026-05-01T10:00:00.000Z',
    deletedAt: null,
    dueDate: null,
    id,
    isFavorite: false,
    kind: 'shopping',
    linkedTaskDeleted: false,
    priority: null,
    shoppingCategory: 'other',
    source: 'manual',
    sphereId: null,
    status: 'new',
    text,
    updatedAt: '2026-05-01T10:00:00.000Z',
    userId: 'user-1',
    version: 1,
    workspaceId: 'workspace-1',
    ...overrides,
  }
}
