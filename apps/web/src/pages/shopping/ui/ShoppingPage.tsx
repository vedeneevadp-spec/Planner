import { type FormEvent, useMemo, useRef, useState } from 'react'
import { useSearchParams } from 'react-router'

import { type SessionReadiness, useSessionAuth } from '@/features/session'
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
  useShoppingListSyncStatus,
  useUpdateShoppingListItem,
} from '@/features/shopping-list'
import { cx } from '@/shared/lib/classnames'
import { useBrowserOffline } from '@/shared/lib/offline-sync'
import { CheckIcon, TrashIcon } from '@/shared/ui/Icon'
import pageStyles from '@/shared/ui/Page'
import { PageStateView, PageStatusBanner } from '@/shared/ui/PageState'

import styles from './ShoppingPage.module.css'

interface ShoppingCategoryOption {
  iconSrc: string
  label: string
  value: ShoppingCategory
}

const SHOPPING_ICON_BASE_URL = '/icons/shopping'
const OTHER_CATEGORY_OPTION = {
  iconSrc: `${SHOPPING_ICON_BASE_URL}/other.webp`,
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
    iconSrc: `${SHOPPING_ICON_BASE_URL}/household.webp`,
    label: 'Бытовое',
    value: 'household',
  },
  OTHER_CATEGORY_OPTION,
] satisfies ShoppingCategoryOption[]
const DRAFT_CATEGORY_OPTIONS = SHOPPING_CATEGORY_OPTIONS.filter(
  (option) => option.value !== 'other',
)
const FAVORITE_ICON_SRC = `${SHOPPING_ICON_BASE_URL}/favorite.webp`
const URGENT_ICON_SRC = `${SHOPPING_ICON_BASE_URL}/urgent.webp`
type ShoppingBlockingState = 'error' | 'loading' | 'offline' | null

export function ShoppingPage() {
  const [searchParams] = useSearchParams()
  const auth = useSessionAuth()
  const [draft, setDraft] = useState('')
  const [draftCategory, setDraftCategory] = useState<ShoppingCategory | null>(
    null,
  )
  const filters = useMemo(
    () => getShoppingFiltersFromSearchParams(searchParams),
    [searchParams],
  )
  const [formError, setFormError] = useState<string | null>(null)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const isSubmittingRef = useRef(false)
  const [pendingItemIds, setPendingItemIds] = useState<Set<string>>(
    () => new Set(),
  )
  const pendingItemIdsRef = useRef<Set<string>>(new Set())
  const shoppingListQuery = useShoppingListSummary()
  const isBrowserOffline = useBrowserOffline()
  const syncStatus = useShoppingListSyncStatus()
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
  const completedEmptyMessage =
    completedItems.length === 0 ? 'Куплено пусто.' : 'По фильтру пусто.'
  const errorMessage = useMemo(
    () =>
      formError ||
      getShoppingErrorMessage(
        createItemMutation.error ??
          updateItemMutation.error ??
          removeItemMutation.error ??
          syncStatus.error,
      ),
    [
      createItemMutation.error,
      formError,
      removeItemMutation.error,
      syncStatus.error,
      updateItemMutation.error,
    ],
  )
  const hasShoppingData = shoppingListQuery.data !== undefined
  const isOffline =
    isBrowserOffline ||
    shoppingListQuery.readiness.status === 'offlineWithCache'
  const blockingState = resolveShoppingBlockingState({
    hasData: hasShoppingData,
    isCacheHydrating: shoppingListQuery.isCacheHydrating,
    isLoading: shoppingListQuery.isLoading,
    isOffline,
    readiness: shoppingListQuery.readiness,
  })
  const hasAccessIssue = isShoppingAccessUnavailable(
    shoppingListQuery.readiness,
  )
  const isRestoring =
    shoppingListQuery.readiness.status === 'restoringWithCache' ||
    shoppingListQuery.readiness.reason === 'auth_restoring' ||
    shoppingListQuery.readiness.reason === 'planner_pending'
  const canMutate = !hasAccessIssue && !isRestoring

  function retryShopping() {
    void (async () => {
      if (hasAccessIssue && auth.isAuthEnabled) {
        const recoveryResult = await auth.recoverSession({
          retryDeniedRefresh: true,
        })

        if (recoveryResult !== 'recovered') {
          return
        }
      }

      await Promise.allSettled([
        shoppingListQuery.retrySession(),
        shoppingListQuery.refetch(),
      ])
    })()
  }

  if (blockingState) {
    return (
      <section className={`${pageStyles.page} ${styles.page}`}>
        <div className={styles.content}>
          {blockingState === 'loading' ? (
            <PageStateView
              kind="loading"
              skeletonVariant="list"
              title={
                isBrowserOffline && shoppingListQuery.isCacheHydrating
                  ? 'Проверяем сохранённый список'
                  : 'Загружаем список покупок'
              }
            />
          ) : blockingState === 'offline' ? (
            <PageStateView
              action={{ label: 'Повторить', onClick: retryShopping }}
              description="На этом устройстве ещё нет сохранённого списка. Подключитесь к сети и попробуйте снова."
              kind="offline"
              lastSyncedAt={shoppingListQuery.lastSuccessfulSyncAt}
              showUnknownLastSync
              title="Список покупок недоступен без подключения"
            />
          ) : (
            <PageStateView
              action={{ label: 'Повторить', onClick: retryShopping }}
              description={
                hasAccessIssue
                  ? 'Восстановите сессию и повторите загрузку.'
                  : 'Попробуйте загрузить список ещё раз.'
              }
              kind="error"
              title={
                hasAccessIssue
                  ? 'Нужно восстановить доступ к списку'
                  : 'Не удалось загрузить список покупок'
              }
            />
          )}
        </div>
      </section>
    )
  }

  const status = hasAccessIssue ? (
    <PageStatusBanner
      action={{ label: 'Обновить доступ', onClick: retryShopping }}
      description="Показываем сохранённый список. Для синхронизации восстановите сессию."
      kind="error"
      lastSyncedAt={shoppingListQuery.lastSuccessfulSyncAt}
      showUnknownLastSync
      title="Нужно восстановить доступ"
    />
  ) : isOffline ? (
    <PageStatusBanner
      action={{ label: 'Обновить', onClick: retryShopping }}
      kind="offline"
      lastSyncedAt={shoppingListQuery.lastSuccessfulSyncAt}
      showUnknownLastSync
    />
  ) : isRestoring ? (
    <PageStatusBanner
      description="Показываем сохранённый список и восстанавливаем синхронизацию."
      kind="info"
      lastSyncedAt={shoppingListQuery.lastSuccessfulSyncAt}
      showUnknownLastSync
      title="Восстанавливаем данные"
    />
  ) : shoppingListQuery.error ? (
    <PageStatusBanner
      action={{ label: 'Обновить', onClick: retryShopping }}
      kind="error"
      lastSyncedAt={shoppingListQuery.lastSuccessfulSyncAt}
      showUnknownLastSync
    />
  ) : undefined

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()

    if (isSubmittingRef.current) {
      return
    }

    const text = formatShoppingListText(draft)

    if (!text) {
      setFormError('Введите покупку.')
      return
    }

    setFormError(null)

    const activeDuplicate = findShoppingListItemByText(activeItems, text)

    if (activeDuplicate) {
      setFormError('Такая покупка уже есть.')
      return
    }

    const completedDuplicate = findShoppingListItemByText(completedItems, text)

    isSubmittingRef.current = true
    setIsSubmitting(true)

    try {
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
    } finally {
      isSubmittingRef.current = false
      setIsSubmitting(false)
    }
  }

  function runItemMutation(itemId: string, action: () => Promise<unknown>) {
    if (pendingItemIdsRef.current.has(itemId)) {
      return
    }

    const nextPendingItemIds = new Set(pendingItemIdsRef.current)
    nextPendingItemIds.add(itemId)
    pendingItemIdsRef.current = nextPendingItemIds
    setPendingItemIds(nextPendingItemIds)

    void action()
      .catch(() => undefined)
      .finally(() => {
        const next = new Set(pendingItemIdsRef.current)
        next.delete(itemId)
        pendingItemIdsRef.current = next
        setPendingItemIds(next)
      })
  }

  function handleToggleFavorite(item: ShoppingListItem) {
    runItemMutation(item.id, () =>
      updateItemMutation.mutateAsync({
        itemId: item.id,
        patch: {
          isFavorite: item.isFavorite !== true,
        },
      }),
    )
  }

  function handleToggleUrgent(item: ShoppingListItem) {
    runItemMutation(item.id, () =>
      updateItemMutation.mutateAsync({
        itemId: item.id,
        patch: {
          priority: item.priority === 'high' ? null : 'high',
        },
      }),
    )
  }

  function renderItemRow(item: ShoppingListItem, isCompleted: boolean) {
    const category = getShoppingCategoryOption(item.shoppingCategory)
    const checkboxId = `shopping-item-${item.id}`
    const isFavorite = item.isFavorite === true
    const isItemPending = pendingItemIds.has(item.id)
    const isUrgent = item.priority === 'high'

    return (
      <div
        key={item.id}
        className={cx(styles.itemRow, isCompleted && styles.itemRowCompleted)}
        aria-busy={isItemPending}
      >
        <div className={styles.itemToggle}>
          <input
            className={styles.checkbox}
            id={checkboxId}
            type="checkbox"
            checked={isCompleted}
            disabled={isItemPending || !canMutate}
            onChange={() => {
              runItemMutation(item.id, () =>
                updateItemMutation.mutateAsync({
                  itemId: item.id,
                  patch: isCompleted
                    ? { status: 'new' }
                    : { priority: null, status: 'archived' },
                }),
              )
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
            disabled={isItemPending || !canMutate}
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
              disabled={isItemPending || !canMutate}
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
            disabled={isItemPending || !canMutate}
            onClick={() => {
              runItemMutation(item.id, () =>
                removeItemMutation.mutateAsync(item.id),
              )
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
          aria-busy={isSubmitting}
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
              disabled={isSubmitting || !canMutate}
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
                  disabled={isSubmitting || !canMutate}
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
            aria-label={isSubmitting ? 'Сохраняем покупку' : 'Добавить покупку'}
            disabled={isSubmitting || !canMutate}
          >
            <CheckIcon size={18} strokeWidth={2.15} />
          </button>
        </form>

        {status}

        {errorMessage ? (
          <p className={styles.errorMessage}>{errorMessage}</p>
        ) : null}

        {syncStatus.queuedMutationCount > 0 ||
        syncStatus.conflictedMutationCount > 0 ? (
          <section
            className={cx(
              styles.syncBanner,
              syncStatus.conflictedMutationCount > 0 &&
                styles.syncBannerWarning,
            )}
            aria-live="polite"
          >
            <div>
              <strong>
                {syncStatus.conflictedMutationCount > 0
                  ? 'Есть конфликтующие покупки'
                  : 'Есть изменения offline'}
              </strong>
              <span>
                {syncStatus.queuedMutationCount} ждут синхронизации
                {syncStatus.conflictedMutationCount > 0
                  ? `, конфликтов: ${syncStatus.conflictedMutationCount}`
                  : ''}
              </span>
            </div>
            <button
              className={styles.syncButton}
              type="button"
              disabled={syncStatus.isSyncing || !canMutate}
              onClick={() => {
                void syncStatus.retry()
              }}
            >
              {syncStatus.isSyncing ? 'Синхронизируем...' : 'Повторить'}
            </button>
          </section>
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
    return 'Сессия недоступна. Войдите в аккаунт снова и повторите действие.'
  }

  return error instanceof Error
    ? error.message
    : 'Не удалось загрузить список покупок.'
}

function resolveShoppingBlockingState(input: {
  hasData: boolean
  isCacheHydrating: boolean
  isLoading: boolean
  isOffline: boolean
  readiness: SessionReadiness
}): ShoppingBlockingState {
  if (input.hasData) {
    return null
  }

  if (
    input.isCacheHydrating ||
    input.isLoading ||
    input.readiness.reason === 'auth_restoring' ||
    input.readiness.reason === 'planner_pending'
  ) {
    return 'loading'
  }

  if (isShoppingAccessUnavailable(input.readiness)) {
    return 'error'
  }

  if (input.isOffline) {
    return 'offline'
  }

  return 'error'
}

function isShoppingAccessUnavailable(
  readiness: Pick<SessionReadiness, 'reason'>,
): boolean {
  return (
    readiness.reason === 'no_session' || readiness.reason === 'unauthorized'
  )
}

function isShoppingSessionReadinessError(error: Error): boolean {
  return /Planner session is required|Shopping list session is not ready/i.test(
    error.message,
  )
}
