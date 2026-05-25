import type { ShoppingListItemDraft } from './useShoppingList'

export type ShoppingCategory = NonNullable<
  ShoppingListItemDraft['shoppingCategory']
>

export interface ShoppingFilters {
  categories: ShoppingCategory[]
  isFavorite: boolean
  isUrgent: boolean
}

export const SHOPPING_FILTER_QUERY_KEYS = {
  categories: 'shoppingCategory',
  favorite: 'shoppingFavorite',
  urgent: 'shoppingUrgent',
} as const

export const SHOPPING_CATEGORY_VALUES = [
  'groceries',
  'household',
  'other',
] as const satisfies readonly ShoppingCategory[]

export const DEFAULT_SHOPPING_FILTERS = {
  categories: [],
  isFavorite: false,
  isUrgent: false,
} satisfies ShoppingFilters

export function getShoppingFiltersFromSearchParams(
  searchParams: URLSearchParams,
): ShoppingFilters {
  const categories = Array.from(
    new Set(
      searchParams
        .getAll(SHOPPING_FILTER_QUERY_KEYS.categories)
        .flatMap((value) => value.split(','))
        .filter(isShoppingCategory),
    ),
  )

  return {
    categories,
    isFavorite: searchParams.get(SHOPPING_FILTER_QUERY_KEYS.favorite) === '1',
    isUrgent: searchParams.get(SHOPPING_FILTER_QUERY_KEYS.urgent) === '1',
  }
}

export function hasActiveShoppingFilters(filters: ShoppingFilters): boolean {
  return filters.categories.length > 0 || filters.isFavorite || filters.isUrgent
}

export function isShoppingCategory(value: string): value is ShoppingCategory {
  return (SHOPPING_CATEGORY_VALUES as readonly string[]).includes(value)
}
