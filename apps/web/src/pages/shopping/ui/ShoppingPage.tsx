import { type FormEvent, useMemo, useState } from 'react'

import {
  useCreateShoppingListItem,
  useRemoveShoppingListItem,
  useShoppingListSummary,
  useUpdateShoppingListItem,
} from '@/features/shopping-list'
import { cx } from '@/shared/lib/classnames'
import { PlusIcon, ShoppingBagIcon, TrashIcon } from '@/shared/ui/Icon'
import pageStyles from '@/shared/ui/Page'
import { PageHeader } from '@/shared/ui/PageHeader'

import styles from './ShoppingPage.module.css'

export function ShoppingPage() {
  const [draft, setDraft] = useState('')
  const [formError, setFormError] = useState<string | null>(null)
  const shoppingListQuery = useShoppingListSummary()
  const createItemMutation = useCreateShoppingListItem()
  const updateItemMutation = useUpdateShoppingListItem()
  const removeItemMutation = useRemoveShoppingListItem()

  const activeItems = shoppingListQuery.activeItems
  const completedItems = shoppingListQuery.completedItems
  const isBusy =
    createItemMutation.isPending ||
    updateItemMutation.isPending ||
    removeItemMutation.isPending
  const errorMessage = useMemo(
    () =>
      formError ||
      (shoppingListQuery.error instanceof Error
        ? shoppingListQuery.error.message
        : createItemMutation.error instanceof Error
          ? createItemMutation.error.message
          : updateItemMutation.error instanceof Error
            ? updateItemMutation.error.message
            : removeItemMutation.error instanceof Error
              ? removeItemMutation.error.message
              : null),
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

    const text = draft.trim()

    if (!text) {
      setFormError('Введите покупку.')
      return
    }

    setFormError(null)

    try {
      await createItemMutation.mutateAsync(text)
      setDraft('')
    } catch {
      // handled through mutation state
    }
  }

  return (
    <section className={`${pageStyles.page} ${styles.page}`}>
      <div className={styles.fixedTop}>
        <PageHeader
          kicker="Shopping"
          title="Список покупок"
          actions={
            <div className={styles.headerStat}>
              <ShoppingBagIcon size={18} strokeWidth={1.9} />
              <strong>{activeItems.length}</strong>
            </div>
          }
        />

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
          </div>

          <button className={styles.addButton} type="submit" disabled={isBusy}>
            <PlusIcon size={18} strokeWidth={2.1} />
            <span>
              {createItemMutation.isPending ? 'Добавляем...' : 'Добавить'}
            </span>
          </button>
        </form>

        {errorMessage ? (
          <p className={styles.errorMessage}>{errorMessage}</p>
        ) : null}
      </div>

      <div className={styles.content}>
        <section className={styles.panel}>
          <div className={styles.panelHeader}>
            <div>
              <p className={styles.panelLabel}>Нужно купить</p>
              <h3>Активные</h3>
            </div>
            <span className={styles.countChip}>{activeItems.length}</span>
          </div>

          {shoppingListQuery.isLoading ? (
            <p className={styles.emptyCopy}>Загружаем список...</p>
          ) : activeItems.length === 0 ? (
            <p className={styles.emptyCopy}>Список пуст.</p>
          ) : (
            <div className={styles.itemList}>
              {activeItems.map((item) => (
                <div key={item.id} className={styles.itemRow}>
                  <label className={styles.itemToggle}>
                    <input
                      className={styles.checkbox}
                      type="checkbox"
                      checked={false}
                      disabled={isBusy}
                      onChange={() => {
                        void updateItemMutation.mutateAsync({
                          itemId: item.id,
                          patch: { status: 'archived' },
                        })
                      }}
                    />
                    <span className={styles.itemText}>{item.text}</span>
                  </label>
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
              ))}
            </div>
          )}
        </section>

        <section className={cx(styles.panel, styles.completedPanel)}>
          <div className={styles.panelHeader}>
            <div>
              <p className={styles.panelLabel}>Уже куплено</p>
              <h3>Завершённые</h3>
            </div>
            <span className={styles.countChip}>{completedItems.length}</span>
          </div>

          {shoppingListQuery.isLoading ? (
            <p className={styles.emptyCopy}>Загружаем список...</p>
          ) : completedItems.length === 0 ? (
            <p className={styles.emptyCopy}>Пока ничего не отмечено.</p>
          ) : (
            <div className={styles.itemList}>
              {completedItems.map((item) => (
                <div
                  key={item.id}
                  className={cx(styles.itemRow, styles.itemRowCompleted)}
                >
                  <label className={styles.itemToggle}>
                    <input
                      className={styles.checkbox}
                      type="checkbox"
                      checked
                      disabled={isBusy}
                      onChange={() => {
                        void updateItemMutation.mutateAsync({
                          itemId: item.id,
                          patch: { status: 'new' },
                        })
                      }}
                    />
                    <span
                      className={cx(styles.itemText, styles.itemTextCompleted)}
                    >
                      {item.text}
                    </span>
                  </label>
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
              ))}
            </div>
          )}
        </section>
      </div>
    </section>
  )
}
