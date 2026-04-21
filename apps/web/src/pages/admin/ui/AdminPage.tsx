import { type FormEvent, useState } from 'react'

import {
  type EmojiAssetKind,
  EmojiGlyph,
  type EmojiSetSource,
  type NewEmojiAssetInput,
} from '@/entities/emoji-set'
import { useCreateEmojiSet, useEmojiSets } from '@/features/emoji-library'
import { usePlannerSession } from '@/features/session'
import pageStyles from '@/shared/ui/Page'
import { PageHeader } from '@/shared/ui/PageHeader'

import styles from './AdminPage.module.css'

interface DraftEmojiItem {
  draftId: string
  keywords: string
  kind: EmojiAssetKind
  label: string
  shortcode: string
  value: string
}

let draftItemCounter = 0

function createDraftEmojiItem(): DraftEmojiItem {
  draftItemCounter += 1

  return {
    draftId: `emoji-item-${draftItemCounter}`,
    keywords: '',
    kind: 'unicode',
    label: '',
    shortcode: '',
    value: '',
  }
}

function canManageAdmin(role: string | undefined): boolean {
  return role === 'admin' || role === 'owner'
}

export function AdminPage() {
  const sessionQuery = usePlannerSession()
  const emojiSetsQuery = useEmojiSets()
  const createEmojiSet = useCreateEmojiSet()
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [source, setSource] = useState<EmojiSetSource>('telegram')
  const [items, setItems] = useState<DraftEmojiItem[]>(() => [
    createDraftEmojiItem(),
  ])
  const [formError, setFormError] = useState<string | null>(null)
  const session = sessionQuery.data
  const canManage = canManageAdmin(session?.role)

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setFormError(null)

    const normalizedTitle = title.trim()
    const normalizedItems = normalizeDraftItems(items)

    if (!normalizedTitle) {
      setFormError('Название набора обязательно.')
      return
    }

    if (normalizedItems.length === 0) {
      setFormError('Добавьте хотя бы один emoji.')
      return
    }

    if (hasIncompleteDraftItem(items)) {
      setFormError('У каждого emoji должны быть код, название и значение.')
      return
    }

    try {
      await createEmojiSet.mutateAsync({
        description,
        items: normalizedItems,
        source,
        title: normalizedTitle,
      })
      setTitle('')
      setDescription('')
      setSource('telegram')
      setItems([createDraftEmojiItem()])
    } catch (error) {
      setFormError(
        error instanceof Error
          ? error.message
          : 'Не удалось сохранить emoji-набор.',
      )
    }
  }

  function updateItem<Field extends keyof Omit<DraftEmojiItem, 'draftId'>>(
    draftId: string,
    field: Field,
    value: DraftEmojiItem[Field],
  ) {
    setItems((currentItems) =>
      currentItems.map((item) =>
        item.draftId === draftId ? { ...item, [field]: value } : item,
      ),
    )
  }

  if (sessionQuery.isLoading) {
    return (
      <section className={pageStyles.page}>
        <PageHeader
          kicker="Admin"
          title="Админка"
          description="Загружаем права текущего workspace."
        />
      </section>
    )
  }

  if (!canManage) {
    return (
      <section className={pageStyles.page}>
        <PageHeader
          kicker="Admin"
          title="Недостаточно прав"
          description="Управление emoji-наборами доступно владельцам и администраторам workspace."
        />
      </section>
    )
  }

  return (
    <section className={pageStyles.page}>
      <PageHeader
        kicker="Admin"
        title="Админка"
        description="Наборы emoji сохраняются на уровне workspace и доступны для будущих picker-компонентов."
      />

      <form
        className={styles.panel}
        onSubmit={(event) => {
          void handleSubmit(event)
        }}
      >
        <div className={styles.formHeader}>
          <div>
            <p className={styles.eyebrow}>Emoji registry</p>
            <h3>Новый набор</h3>
          </div>
          <button
            className={styles.secondaryButton}
            type="button"
            onClick={() =>
              setItems((currentItems) => [
                ...currentItems,
                createDraftEmojiItem(),
              ])
            }
          >
            Добавить emoji
          </button>
        </div>

        <div className={styles.formGrid}>
          <label className={styles.field}>
            <span>Название</span>
            <input
              required
              value={title}
              placeholder="Telegram Planner"
              onChange={(event) => setTitle(event.target.value)}
            />
          </label>

          <label className={styles.field}>
            <span>Источник</span>
            <select
              value={source}
              onChange={(event) =>
                setSource(event.target.value as EmojiSetSource)
              }
            >
              <option value="telegram">Telegram</option>
              <option value="custom">Custom</option>
            </select>
          </label>
        </div>

        <label className={styles.field}>
          <span>Описание</span>
          <textarea
            rows={3}
            value={description}
            placeholder="Маркеры для проектов и задач"
            onChange={(event) => setDescription(event.target.value)}
          />
        </label>

        <div className={styles.itemList}>
          {items.map((item, index) => (
            <div className={styles.itemRow} key={item.draftId}>
              <div className={styles.previewCell}>
                {item.value ? (
                  <EmojiGlyph
                    kind={item.kind}
                    label={item.label || item.shortcode}
                    value={item.value}
                  />
                ) : (
                  <span className={styles.emptyGlyph}>{index + 1}</span>
                )}
              </div>

              <label className={styles.compactField}>
                <span>Тип</span>
                <select
                  value={item.kind}
                  onChange={(event) =>
                    updateItem(
                      item.draftId,
                      'kind',
                      event.target.value as EmojiAssetKind,
                    )
                  }
                >
                  <option value="unicode">Unicode</option>
                  <option value="image">Image</option>
                </select>
              </label>

              <label className={styles.compactField}>
                <span>Код</span>
                <input
                  value={item.shortcode}
                  placeholder="focus"
                  onChange={(event) =>
                    updateItem(item.draftId, 'shortcode', event.target.value)
                  }
                />
              </label>

              <label className={styles.compactField}>
                <span>Название</span>
                <input
                  value={item.label}
                  placeholder="Focus"
                  onChange={(event) =>
                    updateItem(item.draftId, 'label', event.target.value)
                  }
                />
              </label>

              <label className={styles.valueField}>
                <span>Значение</span>
                <input
                  value={item.value}
                  placeholder={
                    item.kind === 'image' ? '/emoji/telegram/focus.webp' : '🎯'
                  }
                  onChange={(event) =>
                    updateItem(item.draftId, 'value', event.target.value)
                  }
                />
              </label>

              <label className={styles.compactField}>
                <span>Ключи</span>
                <input
                  value={item.keywords}
                  placeholder="focus, task"
                  onChange={(event) =>
                    updateItem(item.draftId, 'keywords', event.target.value)
                  }
                />
              </label>

              <button
                className={styles.iconButton}
                type="button"
                aria-label="Удалить emoji"
                disabled={items.length === 1}
                onClick={() =>
                  setItems((currentItems) =>
                    currentItems.filter(
                      (candidate) => candidate.draftId !== item.draftId,
                    ),
                  )
                }
              >
                ×
              </button>
            </div>
          ))}
        </div>

        {formError ? <p className={styles.formError}>{formError}</p> : null}

        <button
          className={styles.primaryButton}
          type="submit"
          disabled={createEmojiSet.isPending}
        >
          {createEmojiSet.isPending ? 'Сохраняем' : 'Сохранить набор'}
        </button>
      </form>

      <section className={styles.section}>
        <div className={styles.sectionHeader}>
          <div>
            <p className={styles.eyebrow}>Library</p>
            <h3>Наборы</h3>
          </div>
          <span className={styles.countBadge}>
            {emojiSetsQuery.data?.length ?? 0}
          </span>
        </div>

        {emojiSetsQuery.isLoading ? (
          <div className={pageStyles.emptyPanel}>Загружаем наборы.</div>
        ) : emojiSetsQuery.data && emojiSetsQuery.data.length > 0 ? (
          <div className={styles.setGrid}>
            {emojiSetsQuery.data.map((emojiSet) => (
              <article className={styles.setCard} key={emojiSet.id}>
                <div className={styles.setCardHeader}>
                  <div>
                    <p className={styles.eyebrow}>{emojiSet.source}</p>
                    <h4>{emojiSet.title}</h4>
                  </div>
                  <span className={styles.countBadge}>
                    {emojiSet.items.length}
                  </span>
                </div>
                {emojiSet.description ? (
                  <p className={styles.description}>{emojiSet.description}</p>
                ) : null}
                <div className={styles.previewList}>
                  {emojiSet.items.slice(0, 12).map((item) => (
                    <EmojiGlyph
                      key={item.id}
                      kind={item.kind}
                      label={item.label}
                      value={item.value}
                    />
                  ))}
                </div>
              </article>
            ))}
          </div>
        ) : (
          <div className={pageStyles.emptyPanel}>Наборов пока нет.</div>
        )}
      </section>
    </section>
  )
}

function normalizeDraftItems(items: DraftEmojiItem[]): NewEmojiAssetInput[] {
  return items
    .filter((item) => hasAnyDraftItemValue(item))
    .map((item) => ({
      keywords: item.keywords
        .split(',')
        .map((keyword) => keyword.trim())
        .filter(Boolean),
      kind: item.kind,
      label: item.label.trim(),
      shortcode: item.shortcode.trim(),
      value: item.value.trim(),
    }))
}

function hasIncompleteDraftItem(items: DraftEmojiItem[]): boolean {
  return items.some(
    (item) =>
      hasAnyDraftItemValue(item) &&
      (!item.label.trim() || !item.shortcode.trim() || !item.value.trim()),
  )
}

function hasAnyDraftItemValue(item: DraftEmojiItem): boolean {
  return Boolean(
    item.label.trim() ||
    item.shortcode.trim() ||
    item.value.trim() ||
    item.keywords.trim(),
  )
}
