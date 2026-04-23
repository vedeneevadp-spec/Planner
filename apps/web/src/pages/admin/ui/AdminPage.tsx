import { type ChangeEvent, type FormEvent, useState } from 'react'

import { EmojiGlyph, type NewEmojiAssetInput } from '@/entities/emoji-set'
import {
  useAddEmojiSetItems,
  useCreateEmojiSet,
  useDeleteEmojiSet,
  useDeleteEmojiSetItem,
  useEmojiSets,
} from '@/features/emoji-library'
import { usePlannerSession } from '@/features/session'
import pageStyles from '@/shared/ui/Page'
import { PageHeader } from '@/shared/ui/PageHeader'

import {
  ACCEPTED_ICON_TYPES,
  createLabelFromFile,
  formatFileSize,
  MAX_ICON_ASSET_BYTES,
  prepareIconUpload,
  validateIconFile,
} from '../lib/icon-upload'
import styles from './AdminPage.module.css'

interface DraftIconItem {
  draftId: string
  fileError: string | null
  fileName: string
  label: string
  value: string
}

const NEW_ICON_SET_TARGET = 'new'

let draftItemCounter = 0

function createDraftIconItem(): DraftIconItem {
  draftItemCounter += 1

  return {
    draftId: `icon-item-${draftItemCounter}`,
    fileError: null,
    fileName: '',
    label: '',
    value: '',
  }
}

function canManageAdmin(role: string | undefined): boolean {
  return role === 'admin' || role === 'owner'
}

export function AdminPage() {
  const sessionQuery = usePlannerSession()
  const iconSetsQuery = useEmojiSets()
  const addIconSetItems = useAddEmojiSetItems()
  const createIconSet = useCreateEmojiSet()
  const deleteIconSet = useDeleteEmojiSet()
  const deleteIconSetItem = useDeleteEmojiSetItem()
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [targetSetId, setTargetSetId] = useState(NEW_ICON_SET_TARGET)
  const [items, setItems] = useState<DraftIconItem[]>(() => [
    createDraftIconItem(),
  ])
  const [formError, setFormError] = useState<string | null>(null)
  const [libraryError, setLibraryError] = useState<string | null>(null)
  const [brokenIconIds, setBrokenIconIds] = useState<Set<string>>(
    () => new Set(),
  )
  const session = sessionQuery.data
  const canManage = canManageAdmin(session?.role)
  const iconSets = iconSetsQuery.data ?? []
  const isCreatingNewSet = targetSetId === NEW_ICON_SET_TARGET
  const isSaving = createIconSet.isPending || addIconSetItems.isPending
  const isDeleting = deleteIconSet.isPending || deleteIconSetItem.isPending

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setFormError(null)

    const normalizedTitle = title.trim()
    const normalizedItems = normalizeDraftItems(items)

    if (isCreatingNewSet && !normalizedTitle) {
      setFormError('Название набора обязательно.')
      return
    }

    if (normalizedItems.length === 0) {
      setFormError('Добавьте хотя бы одну иконку.')
      return
    }

    if (hasIncompleteDraftItem(items)) {
      setFormError('У каждой иконки должны быть название и файл.')
      return
    }

    if (items.some((item) => item.fileError)) {
      setFormError('Исправьте ошибки загрузки файлов.')
      return
    }

    if (
      !isCreatingNewSet &&
      !iconSets.some((iconSet) => iconSet.id === targetSetId)
    ) {
      setFormError('Выберите существующий набор или создайте новый.')
      return
    }

    try {
      if (isCreatingNewSet) {
        await createIconSet.mutateAsync({
          description,
          items: normalizedItems,
          title: normalizedTitle,
        })
        setTitle('')
        setDescription('')
      } else {
        await addIconSetItems.mutateAsync({
          emojiSetId: targetSetId,
          items: normalizedItems,
        })
      }

      setItems([createDraftIconItem()])
    } catch (error) {
      setFormError(
        error instanceof Error
          ? error.message
          : 'Не удалось сохранить набор иконок.',
      )
    }
  }

  function updateItem<Field extends keyof Omit<DraftIconItem, 'draftId'>>(
    draftId: string,
    field: Field,
    value: DraftIconItem[Field],
  ) {
    setItems((currentItems) =>
      currentItems.map((item) =>
        item.draftId === draftId ? { ...item, [field]: value } : item,
      ),
    )
  }

  async function handleIconFileChange(
    draftId: string,
    event: ChangeEvent<HTMLInputElement>,
  ) {
    const file = event.currentTarget.files?.[0]
    event.currentTarget.value = ''

    if (!file) {
      return
    }

    const validationError = validateIconFile(file)

    if (validationError) {
      setItems((currentItems) =>
        currentItems.map((item) =>
          item.draftId === draftId
            ? {
                ...item,
                fileError: validationError,
                fileName: file.name,
                value: '',
              }
            : item,
        ),
      )
      return
    }

    try {
      const { value } = await prepareIconUpload(file)

      setItems((currentItems) =>
        currentItems.map((item) =>
          item.draftId === draftId
            ? {
                ...item,
                fileError: null,
                fileName: file.name,
                label: item.label.trim()
                  ? item.label
                  : createLabelFromFile(file),
                value,
              }
            : item,
        ),
      )
    } catch (error) {
      setItems((currentItems) =>
        currentItems.map((item) =>
          item.draftId === draftId
            ? {
                ...item,
                fileError:
                  error instanceof Error
                    ? error.message
                    : 'Не удалось прочитать файл.',
                fileName: file.name,
                value: '',
              }
            : item,
        ),
      )
    }
  }

  async function handleDeleteIconSet(iconSetId: string, iconSetTitle: string) {
    if (!window.confirm(`Удалить набор "${iconSetTitle}" вместе с иконками?`)) {
      return
    }

    setLibraryError(null)

    try {
      await deleteIconSet.mutateAsync(iconSetId)

      if (targetSetId === iconSetId) {
        setTargetSetId(NEW_ICON_SET_TARGET)
      }
    } catch (error) {
      setLibraryError(
        error instanceof Error ? error.message : 'Не удалось удалить набор.',
      )
    }
  }

  async function handleDeleteIconItem(
    iconSetId: string,
    iconAssetId: string,
    iconLabel: string,
  ) {
    if (!window.confirm(`Удалить иконку "${iconLabel}"?`)) {
      return
    }

    setLibraryError(null)

    try {
      await deleteIconSetItem.mutateAsync({
        emojiSetId: iconSetId,
        iconAssetId,
      })
      setBrokenIconIds((currentIconIds) => {
        const nextIconIds = new Set(currentIconIds)

        nextIconIds.delete(iconAssetId)

        return nextIconIds
      })
    } catch (error) {
      setLibraryError(
        error instanceof Error ? error.message : 'Не удалось удалить иконку.',
      )
    }
  }

  function markIconAsBroken(iconAssetId: string) {
    setBrokenIconIds((currentIconIds) => {
      if (currentIconIds.has(iconAssetId)) {
        return currentIconIds
      }

      const nextIconIds = new Set(currentIconIds)

      nextIconIds.add(iconAssetId)

      return nextIconIds
    })
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
          description="Управление наборами иконок доступно владельцам и администраторам workspace."
        />
      </section>
    )
  }

  return (
    <section className={pageStyles.page}>
      <PageHeader
        kicker="Admin"
        title="Админка"
        description="Загружайте иконки в наборы workspace, чтобы использовать их в будущих компонентах выбора."
      />

      <form
        className={styles.panel}
        onSubmit={(event) => {
          void handleSubmit(event)
        }}
      >
        <div className={styles.formHeader}>
          <div>
            <p className={styles.eyebrow}>Icon registry</p>
            <h3>{isCreatingNewSet ? 'Новый набор' : 'Пополнить набор'}</h3>
          </div>
          <button
            className={styles.secondaryButton}
            type="button"
            onClick={() =>
              setItems((currentItems) => [
                ...currentItems,
                createDraftIconItem(),
              ])
            }
          >
            Добавить иконку
          </button>
        </div>

        <div className={styles.formGrid}>
          <label className={styles.field}>
            <span>Куда добавить</span>
            <select
              value={targetSetId}
              onChange={(event) => setTargetSetId(event.target.value)}
            >
              <option value={NEW_ICON_SET_TARGET}>Создать новый набор</option>
              {iconSets.map((iconSet) => (
                <option key={iconSet.id} value={iconSet.id}>
                  {iconSet.title}
                </option>
              ))}
            </select>
          </label>

          {isCreatingNewSet ? (
            <label className={styles.field}>
              <span>Название набора</span>
              <input
                required
                value={title}
                placeholder="Рабочие статусы"
                onChange={(event) => setTitle(event.target.value)}
              />
            </label>
          ) : null}
        </div>

        {isCreatingNewSet ? (
          <label className={styles.field}>
            <span>Описание</span>
            <textarea
              rows={3}
              value={description}
              placeholder="Иконки для сфер и задач"
              onChange={(event) => setDescription(event.target.value)}
            />
          </label>
        ) : (
          <div className={styles.selectedSetNote}>
            Иконки будут добавлены в выбранный набор.
          </div>
        )}

        <div className={styles.itemList}>
          {items.map((item, index) => (
            <div className={styles.itemRow} key={item.draftId}>
              <div className={styles.previewCell}>
                {item.value ? (
                  <EmojiGlyph
                    kind="image"
                    label={item.label}
                    value={item.value}
                  />
                ) : (
                  <span className={styles.emptyGlyph}>{index + 1}</span>
                )}
              </div>

              <label className={styles.nameField}>
                <span>Название иконки</span>
                <input
                  value={item.label}
                  placeholder="Фокус"
                  onChange={(event) =>
                    updateItem(item.draftId, 'label', event.target.value)
                  }
                />
              </label>

              <label className={styles.uploadField}>
                <span>Файл</span>
                <span className={styles.uploadControl}>
                  <input
                    className={styles.fileInput}
                    type="file"
                    accept={ACCEPTED_ICON_TYPES}
                    onChange={(event) => {
                      void handleIconFileChange(item.draftId, event)
                    }}
                  />
                  <span className={styles.uploadText}>
                    {item.fileName || 'Выбрать файл'}
                  </span>
                </span>
                {item.fileError ? (
                  <small className={styles.fieldError}>{item.fileError}</small>
                ) : (
                  <small className={styles.fileHint}>
                    PNG, SVG, WebP, JPG, GIF, WebM или TGS; WebM/TGS
                    сохраняются как PNG до{' '}
                    {formatFileSize(MAX_ICON_ASSET_BYTES)}.
                  </small>
                )}
              </label>

              <button
                className={styles.iconButton}
                type="button"
                aria-label="Удалить иконку"
                disabled={items.length === 1}
                onClick={() =>
                  setItems((currentItems) =>
                    currentItems.filter(
                      (candidate) => candidate.draftId !== item.draftId,
                    ),
                  )
                }
              >
                x
              </button>
            </div>
          ))}
        </div>

        {formError ? <p className={styles.formError}>{formError}</p> : null}

        <button
          className={styles.primaryButton}
          type="submit"
          disabled={isSaving}
        >
          {isSaving
            ? 'Сохраняем'
            : isCreatingNewSet
              ? 'Сохранить набор'
              : 'Добавить в набор'}
        </button>
      </form>

      <section className={styles.section}>
        <div className={styles.sectionHeader}>
          <div>
            <p className={styles.eyebrow}>Library</p>
            <h3>Наборы</h3>
          </div>
          <span className={styles.countBadge}>{iconSets.length}</span>
        </div>

        {libraryError ? (
          <p className={styles.formError}>{libraryError}</p>
        ) : null}

        {iconSetsQuery.isLoading ? (
          <div className={pageStyles.emptyPanel}>Загружаем наборы.</div>
        ) : iconSets.length > 0 ? (
          <div className={styles.setGrid}>
            {iconSets.map((iconSet) => (
              <article className={styles.setCard} key={iconSet.id}>
                <div className={styles.setCardHeader}>
                  <div>
                    <p className={styles.eyebrow}>Icon set</p>
                    <h4>{iconSet.title}</h4>
                  </div>
                  <div className={styles.setHeaderActions}>
                    <span className={styles.countBadge}>
                      {iconSet.items.length}
                    </span>
                    <button
                      className={styles.dangerButton}
                      type="button"
                      disabled={isDeleting}
                      onClick={() => {
                        void handleDeleteIconSet(iconSet.id, iconSet.title)
                      }}
                    >
                      Удалить набор
                    </button>
                  </div>
                </div>
                {iconSet.description ? (
                  <p className={styles.description}>{iconSet.description}</p>
                ) : null}
                <div className={styles.previewList}>
                  {iconSet.items.length > 0 ? (
                    iconSet.items.map((item) => {
                      const isBroken = brokenIconIds.has(item.id)

                      return (
                        <span
                          className={`${styles.iconChip} ${
                            isBroken ? styles.brokenIconChip : ''
                          }`}
                          key={item.id}
                        >
                          <EmojiGlyph
                            kind={item.kind}
                            label={item.label}
                            value={item.value}
                            onError={() => markIconAsBroken(item.id)}
                          />
                          <span className={styles.iconLabel}>{item.label}</span>
                          {isBroken ? (
                            <span className={styles.brokenLabel}>битая</span>
                          ) : null}
                          <button
                            className={styles.chipDeleteButton}
                            type="button"
                            disabled={isDeleting}
                            onClick={() => {
                              void handleDeleteIconItem(
                                iconSet.id,
                                item.id,
                                item.label,
                              )
                            }}
                          >
                            Удалить
                          </button>
                        </span>
                      )
                    })
                  ) : (
                    <p className={styles.emptySetNote}>
                      В наборе пока нет иконок.
                    </p>
                  )}
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

function normalizeDraftItems(items: DraftIconItem[]): NewEmojiAssetInput[] {
  return items
    .filter((item) => hasAnyDraftItemValue(item))
    .map((item) => ({
      kind: 'image',
      label: item.label.trim(),
      value: item.value.trim(),
    }))
}

function hasIncompleteDraftItem(items: DraftIconItem[]): boolean {
  return items.some(
    (item) =>
      hasAnyDraftItemValue(item) && (!item.label.trim() || !item.value.trim()),
  )
}

function hasAnyDraftItemValue(item: DraftIconItem): boolean {
  return Boolean(item.label.trim() || item.value.trim() || item.fileName.trim())
}
