import type { ChaosInboxItemRecord } from '@planner/contracts'
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { ShoppingPage } from './ShoppingPage'

const mocks = vi.hoisted(() => ({
  createItem: vi.fn(),
  removeItem: vi.fn(),
  useShoppingListSummary: vi.fn(),
  useShoppingListSyncStatus: vi.fn(),
  updateItem: vi.fn(),
}))

vi.mock('@/features/shopping-list', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>()

  return {
    ...actual,
    useCreateShoppingListItem: () => ({
      error: null,
      isPending: false,
      mutateAsync: mocks.createItem,
    }),
    useRemoveShoppingListItem: () => ({
      error: null,
      isPending: false,
      mutateAsync: mocks.removeItem,
    }),
    useShoppingListSummary: mocks.useShoppingListSummary,
    useShoppingListSyncStatus: mocks.useShoppingListSyncStatus,
    useUpdateShoppingListItem: () => ({
      error: null,
      isPending: false,
      mutateAsync: mocks.updateItem,
    }),
  }
})

describe('ShoppingPage', () => {
  beforeEach(() => {
    mocks.createItem.mockReset()
    mocks.createItem.mockResolvedValue(undefined)
    mocks.removeItem.mockReset()
    mocks.removeItem.mockResolvedValue(undefined)
    mocks.updateItem.mockReset()
    mocks.updateItem.mockResolvedValue(undefined)
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

  it('submits a shopping draft only once while the local save is pending', async () => {
    const save = createDeferred<void>()
    mocks.createItem.mockReturnValue(save.promise)

    renderShoppingPage('/shopping')

    const input = screen.getByPlaceholderText('Добавить покупку')
    const form = input.closest('form')

    if (!form) {
      throw new Error('Expected the shopping composer form.')
    }

    fireEvent.change(input, { target: { value: 'Молоко' } })
    fireEvent.submit(form)
    fireEvent.submit(form)

    expect(mocks.createItem).toHaveBeenCalledTimes(1)
    expect(screen.getByLabelText('Сохраняем покупку')).toBeDisabled()

    await act(async () => {
      save.resolve()
      await save.promise
    })

    await waitFor(() => {
      expect(screen.getByLabelText('Добавить покупку')).toBeEnabled()
    })
    expect(input).toHaveValue('')
  })

  it('locks only the shopping row being changed', async () => {
    const save = createDeferred<void>()
    mocks.updateItem.mockReturnValue(save.promise)
    mocks.useShoppingListSummary.mockReturnValue({
      activeItems: [
        createShoppingItem({ id: 'item-1', text: 'Молоко' }),
        createShoppingItem({ id: 'item-2', text: 'Хлеб' }),
      ],
      completedItems: [],
      error: null,
      isLoading: false,
    })

    renderShoppingPage('/shopping')
    fireEvent.click(screen.getByLabelText('Добавить в избранное: Молоко'))

    expect(screen.getByPlaceholderText('Добавить покупку')).toBeEnabled()
    expect(screen.getByLabelText('Удалить Молоко')).toBeDisabled()
    expect(screen.getByLabelText('Удалить Хлеб')).toBeEnabled()

    await act(async () => {
      save.resolve()
      await save.promise
    })

    await waitFor(() => {
      expect(screen.getByLabelText('Удалить Молоко')).toBeEnabled()
    })
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
    activatedAt: '2026-05-01T10:00:00.000Z',
    completedAt: null,
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

function createDeferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise
  })

  return { promise, resolve }
}
