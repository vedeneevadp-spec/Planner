import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { ShoppingPage } from './ShoppingPage'

const mocks = vi.hoisted(() => ({
  useShoppingListSummary: vi.fn(),
}))

vi.mock('@/features/shopping-list', () => ({
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
  useUpdateShoppingListItem: () => ({
    error: null,
    isPending: false,
    mutateAsync: vi.fn(),
  }),
}))

describe('ShoppingPage', () => {
  beforeEach(() => {
    mocks.useShoppingListSummary.mockReturnValue({
      activeItems: [],
      completedItems: [],
      error: null,
      isLoading: false,
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

    render(<ShoppingPage />)

    expect(
      screen.getByText(
        'Нет соединения. Изменения сохранятся локально и синхронизируются автоматически.',
      ),
    ).toBeVisible()
  })
})
