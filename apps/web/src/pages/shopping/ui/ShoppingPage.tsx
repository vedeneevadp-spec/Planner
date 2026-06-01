import { type FormEvent, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'

import {
  findShoppingListItemByText,
  formatShoppingListText,
  getShoppingFiltersFromSearchParams,
  hasActiveShoppingFilters,
  type ShoppingCategory,
  type ShoppingFilters,
  type ShoppingListItem,
  useCreateShoppingListItem,
  useRemoveShoppingListItem,
  useShoppingListSummary,
  useUpdateShoppingListItem,
} from '@/features/shopping-list'
import { cx } from '@/shared/lib/classnames'
import { CheckIcon, TrashIcon } from '@/shared/ui/Icon'
import pageStyles from '@/shared/ui/Page'

import styles from './ShoppingPage.module.css'

interface ShoppingCategoryOption {
  iconSrc: string
  label: string
  value: ShoppingCategory
}

const SHOPPING_ICON_BASE_URL = '/icons/shopping'
const OTHER_CATEGORY_OPTION = {
  iconSrc: `${SHOPPING_ICON_BASE_URL}/other.png`,
  label: 'Прочее',
  value: 'other',
} satisfies ShoppingCategoryOption
const SHOPPING_CATEGORY_OPTIONS = [
  {
    iconSrc: `${SHOPPING_ICON_BASE_URL}/groceries.webp`,
    label: 'Продукты',
    value: 'groceries',
  },
  {
    iconSrc: `${SHOPPING_ICON_BASE_URL}/household.png`,
    label: 'Бытовое',
    value: 'household',
  },
  OTHER_CATEGORY_OPTION,
] satisfies ShoppingCategoryOption[]
const DRAFT_CATEGORY_OPTIONS = SHOPPING_CATEGORY_OPTIONS.filter(
  (option) => option.value !== 'other',
)
const FAVORITE_ICON_SRC = `${SHOPPING_ICON_BASE_URL}/favorite.png`
const URGENT_ICON_SRC = `${SHOPPING_ICON_BASE_URL}/urgent.webp`

export function ShoppingPage() {
  const [searchParams] = useSearchParams()
  const [draft, setDraft] = useState('')
  const [draftCategory, setDraftCategory] = useState<ShoppingCategory | null>(
    null,
  )
  const filters = useMemo(
    () => getShoppingFiltersFromSearchParams(searchParams),
    [searchParams],
  )
  const [formError, setFormError] = useState<string | null>(null)
  const shoppingListQuery = useShoppingListSummary()
  const createItemMutation = useCreateShoppingListItem()
  const updateItemMutation = useUpdateShoppingListItem()
  const removeItemMutation = useRemoveShoppingListItem()

  const activeItems = shoppingListQuery.activeItems
  const completedItems = shoppingListQuery.completedItems
  const filteredActiveItems = useMemo(
    () => filterShoppingItems(activeItems, filters),
    [activeItems, filters],
  )
  const filteredCompletedItems = useMemo(
    () => filterShoppingItems(completedItems, filters),
    [completedItems, filters],
  )
  const isBusy =
    createItemMutation.isPending ||
    updateItemMutation.isPending ||
    removeItemMutation.isPending
  const completedEmptyMessage =
    completedItems.length === 0 ? 'Куплено пусто.' : 'По фильтру пусто.'
  const errorMessage = useMemo(
    () =>
      formError ||
      getShoppingErrorMessage(
        shoppingListQuery.error ??
          createItemMutation.error ??
          updateItemMutation.error ??
          removeItemMutation.error,
      ),
    [
      createItemMutation.error,
      formError,
      removeItemMutation.error,
      shoppingListQuery.error,
      updateItemMutation.error,
    ],
  )

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()

    const text = formatShoppingListText(draft)

    if (!text) {
      setFormError('Введите покупку.')
      return
    }

    setFormError(null)

    try {
      const activeDuplicate = findShoppingListItemByText(activeItems, text)

      if (activeDuplicate) {
        setFormError('Такая покупка уже есть.')
        return
      }

      const completedDuplicate = findShoppingListItemByText(
        completedItems,
        text,
      )

      if (completedDuplicate) {
        await updateItemMutation.mutateAsync({
          itemId: completedDuplicate.id,
          patch: { status: 'new' },
        })
        setDraft('')
        setDraftCategory(null)
        return
      }

      await createItemMutation.mutateAsync({
        isFavorite: false,
        priority: null,
        shoppingCategory: draftCategory ?? 'other',
        text,
      })
      setDraft('')
      setDraftCategory(null)
    } catch {
      // handled through mutation state
    }
  }

  function handleToggleFavorite(item: ShoppingListItem) {
    void updateItemMutation.mutateAsync({
      itemId: item.id,
      patch: {
        isFavorite: item.isFavorite !== true,
      },
    })
  }

  function handleToggleUrgent(item: ShoppingListItem) {
    void updateItemMutation.mutateAsync({
      itemId: item.id,
      patch: {
        priority: item.priority === 'high' ? null : 'high',
      },
    })
  }

  function renderItemRow(item: ShoppingListItem, isCompleted: boolean) {
    const category = getShoppingCategoryOption(item.shoppingCategory)
    const checkboxId = `shopping-item-${item.id}`
    const isFavorite = item.isFavorite === true
    const isUrgent = item.priority === 'high'

    return (
      <div
        key={item.id}
        className={cx(styles.itemRow, isCompleted && styles.itemRowCompleted)}
      >
        <div className={styles.itemToggle}>
          <input
            className={styles.checkbox}
            id={checkboxId}
            type="checkbox"
            checked={isCompleted}
            disabled={isBusy}
            onChange={() => {
              void updateItemMutation.mutateAsync({
                itemId: item.id,
                patch: isCompleted
                  ? { status: 'new' }
                  : { priority: null, status: 'archived' },
              })
            }}
          />
          <label className={styles.itemLine} htmlFor={checkboxId}>
            <span
              className={styles.categoryBadge}
              aria-label={`Тип: ${category.label}`}
              title={category.label}
            >
              <img
                src={category.iconSrc}
                alt=""
                aria-hidden="true"
                className={styles.categoryIcon}
              />
            </span>
            <span
              className={cx(
                styles.itemText,
                isCompleted && styles.itemTextCompleted,
              )}
            >
              {item.text}
            </span>
          </label>
        </div>
        <div className={styles.itemActions}>
          <button
            className={cx(
              styles.markButton,
              isFavorite && styles.markButtonActive,
            )}
            type="button"
            aria-label={
              isFavorite
                ? `Убрать из избранного: ${item.text}`
                : `Добавить в избранное: ${item.text}`
            }
            aria-pressed={isFavorite}
            disabled={isBusy}
            onClick={() => {
              handleToggleFavorite(item)
            }}
          >
            <img src={FAVORITE_ICON_SRC} alt="" aria-hidden="true" />
          </button>
          {!isCompleted ? (
            <button
              className={cx(
                styles.markButton,
                isUrgent && styles.markButtonActive,
                isUrgent && styles.markButtonUrgent,
              )}
              type="button"
              aria-label={
                isUrgent
                  ? `Снять срочность: ${item.text}`
                  : `Пометить срочным: ${item.text}`
              }
              aria-pressed={isUrgent}
              disabled={isBusy}
              onClick={() => {
                handleToggleUrgent(item)
              }}
            >
              <img src={URGENT_ICON_SRC} alt="" aria-hidden="true" />
            </button>
          ) : null}
          <button
            className={styles.iconButton}
            type="button"
            aria-label={`Удалить ${item.text}`}
            disabled={isBusy}
            onClick={() => {
              void removeItemMutation.mutateAsync(item.id)
            }}
          >
            <TrashIcon size={18} strokeWidth={2.05} />
          </button>
        </div>
      </div>
    )
  }

  function renderCompletedPanelContent() {
    if (shoppingListQuery.isLoading) {
      return null
    }

    if (filteredCompletedItems.length === 0) {
      return <p className={styles.emptyCopy}>{completedEmptyMessage}</p>
    }

    return (
      <div className={styles.itemList}>
        {filteredCompletedItems.map((item) => renderItemRow(item, true))}
      </div>
    )
  }

  return (
    <section className={`${pageStyles.page} ${styles.page}`}>
      <div className={styles.fixedTop}>
        <form
          className={styles.composer}
          onSubmit={(event) => {
            void handleSubmit(event)
          }}
        >
          <div className={styles.composerField}>
            <input
              type="text"
              value={draft}
              maxLength={5000}
              placeholder="Добавить покупку"
              disabled={isBusy}
              onChange={(event) => {
                setDraft(event.target.value)
                setFormError(null)
              }}
            />
            <div className={styles.inputCategoryControls}>
              {DRAFT_CATEGORY_OPTIONS.map((option) => (
                <button
                  key={option.value}
                  className={cx(
                    styles.inputCategoryButton,
                    draftCategory === option.value &&
                      styles.inputCategoryButtonActive,
                  )}
                  type="button"
                  aria-label={
                    draftCategory === option.value
                      ? `Снять вид: ${option.label}`
                      : `Выбрать вид: ${option.label}`
                  }
                  aria-pressed={draftCategory === option.value}
                  disabled={isBusy}
                  onClick={() => {
                    setDraftCategory((currentCategory) =>
                      currentCategory === option.value ? null : option.value,
                    )
                  }}
                >
                  <img src={option.iconSrc} alt="" aria-hidden="true" />
                </button>
              ))}
            </div>
          </div>

          <button
            className={styles.addButton}
            type="submit"
            aria-label="Добавить покупку"
            disabled={isBusy}
          >
            <CheckIcon size={18} strokeWidth={2.15} />
          </button>
        </form>

        {errorMessage ? (
          <p className={styles.errorMessage}>{errorMessage}</p>
        ) : null}
      </div>

      <div className={styles.content}>
        <section className={styles.panel} aria-label="Актуальные покупки">
          {shoppingListQuery.isLoading ? (
            <p className={styles.emptyCopy}>Загружаем список...</p>
          ) : filteredActiveItems.length === 0 ? (
            <p className={styles.emptyCopy}>
              {activeItems.length === 0 ? 'Список пуст.' : 'По фильтру пусто.'}
            </p>
          ) : (
            <div className={styles.itemList}>
              {filteredActiveItems.map((item) => renderItemRow(item, false))}
            </div>
          )}
        </section>

        <section
          className={cx(styles.panel, styles.completedPanel)}
          aria-label="Купленные покупки"
          data-empty={filteredCompletedItems.length === 0 ? 'true' : undefined}
        >
          {renderCompletedPanelContent()}
        </section>
      </div>
    </section>
  )
}

function filterShoppingItems(
  items: ShoppingListItem[],
  filters: ShoppingFilters,
): ShoppingListItem[] {
  if (!hasActiveShoppingFilters(filters)) {
    return items
  }

  return items.filter((item) => {
    const category = item.shoppingCategory ?? 'other'
    const matchesCategory =
      filters.categories.length === 0 || filters.categories.includes(category)
    const matchesFavorite = !filters.isFavorite || item.isFavorite === true
    const matchesUrgent = !filters.isUrgent || item.priority === 'high'

    return matchesCategory && matchesFavorite && matchesUrgent
  })
}

function getShoppingCategoryOption(
  category: ShoppingListItem['shoppingCategory'] | undefined,
): ShoppingCategoryOption {
  return (
    SHOPPING_CATEGORY_OPTIONS.find((option) => option.value === category) ??
    OTHER_CATEGORY_OPTION
  )
}

function getShoppingErrorMessage(error: unknown): string | null {
  if (!error) {
    return null
  }

  if (error instanceof Error && isShoppingSessionReadinessError(error)) {
    return 'Нет соединения. Изменения сохранятся локально и синхронизируются автоматически.'
  }

  return error instanceof Error
    ? error.message
    : 'Не удалось загрузить список покупок.'
}

function isShoppingSessionReadinessError(error: Error): boolean {
  return /Planner session is required|Shopping list session is not ready/i.test(
    error.message,
  )
}
