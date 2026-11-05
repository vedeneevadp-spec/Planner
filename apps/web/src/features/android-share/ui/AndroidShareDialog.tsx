import type { ChaosInboxShoppingCategory } from '@planner/contracts'
import { type FormEvent, useState } from 'react'

import { ChecklistIcon, ShoppingBagIcon } from '@/shared/ui/Icon'
import { PlannerDialog } from '@/shared/ui/PlannerDialog/PlannerDialog'

import styles from './AndroidShareDialog.module.css'

export interface AndroidShareDraft {
  kind: 'task' | 'purchase'
  title: string
  workspaceId: string
  dueDate: string | null
  shoppingCategory: ChaosInboxShoppingCategory
}

interface AndroidShareDialogProps {
  initialKind: AndroidShareDraft['kind']
  initialTitle: string
  originalText: string
  url: string | null
  initialWorkspaceId: string
  workspaces: ReadonlyArray<{ id: string; name: string }>
  busy: boolean
  error: string | null
  onCancel: () => void
  onSave: (draft: AndroidShareDraft) => void
}

const categoryOptions: ReadonlyArray<{
  value: ChaosInboxShoppingCategory
  label: string
}> = [
  { value: 'other', label: 'Прочее' },
  { value: 'groceries', label: 'Продукты' },
  { value: 'household', label: 'Бытовое' },
]

export function AndroidShareDialog({
  initialKind,
  initialTitle,
  originalText,
  url,
  initialWorkspaceId,
  workspaces,
  busy,
  error,
  onCancel,
  onSave,
}: AndroidShareDialogProps) {
  const [kind, setKind] = useState(initialKind)
  const [title, setTitle] = useState(initialTitle)
  const [workspaceId, setWorkspaceId] = useState(initialWorkspaceId)
  const [dueDate, setDueDate] = useState('')
  const [shoppingCategory, setShoppingCategory] =
    useState<ChaosInboxShoppingCategory>('other')
  const isTask = kind === 'task'
  const titleLimit = isTask ? 240 : 5000
  const cleanTitle = title.trim()
  const isTitleTooLong = cleanTitle.length > titleLimit
  const hasWorkspace = workspaces.some(({ id }) => id === workspaceId)
  const canSave =
    !busy && Boolean(cleanTitle) && !isTitleTooLong && hasWorkspace

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (canSave) {
      onSave({
        kind,
        title: cleanTitle,
        workspaceId,
        dueDate: isTask && dueDate ? dueDate : null,
        shoppingCategory,
      })
    }
  }

  return (
    <PlannerDialog
      title="Что добавить?"
      subtitle="Черновик из меню «Поделиться»"
      busy={busy}
      initialFocus="button[aria-pressed=true]"
      onClose={onCancel}
    >
      <form className={styles.form} onSubmit={submit} aria-busy={busy}>
        <div role="group" aria-label="Тип записи" className={styles.kinds}>
          <button
            type="button"
            aria-pressed={isTask}
            disabled={busy}
            onClick={() => setKind('task')}
          >
            <ChecklistIcon size={18} />
            Задачу
          </button>
          <button
            type="button"
            aria-pressed={!isTask}
            disabled={busy}
            onClick={() => setKind('purchase')}
          >
            <ShoppingBagIcon size={18} />
            Покупку
          </button>
        </div>

        <label className={styles.field}>
          Название
          <input
            name="title"
            required
            disabled={busy}
            value={title}
            maxLength={titleLimit}
            aria-invalid={isTitleTooLong}
            onChange={(event) => setTitle(event.target.value)}
          />
        </label>
        {isTitleTooLong && (
          <p className={styles.error} role="alert">
            Сократите название до {titleLimit} символов.
          </p>
        )}

        {url && (
          <p className={styles.link}>
            <strong>Ссылка</strong>
            <span className={styles.address}>{url}</span>
          </p>
        )}
        {originalText && originalText.trim() !== url && (
          <details className={styles.original}>
            <summary>Исходный текст</summary>
            <p>{originalText}</p>
          </details>
        )}

        <div className={styles.fields}>
          <label className={styles.field}>
            Пространство
            <select
              name="workspace"
              required
              value={hasWorkspace ? workspaceId : ''}
              disabled={busy}
              onChange={(event) => setWorkspaceId(event.target.value)}
            >
              {!hasWorkspace && <option value="">Выбрать пространство</option>}
              {workspaces.map((workspace) => (
                <option key={workspace.id} value={workspace.id}>
                  {workspace.name}
                </option>
              ))}
            </select>
          </label>
          {isTask ? (
            <label className={styles.field}>
              Срок
              <input
                name="dueDate"
                type="date"
                value={dueDate}
                disabled={busy}
                onChange={(event) => setDueDate(event.target.value)}
              />
            </label>
          ) : (
            <label className={styles.field}>
              Категория
              <select
                name="shoppingCategory"
                disabled={busy}
                value={shoppingCategory}
                onChange={(event) => {
                  const option = categoryOptions.find(
                    ({ value }) => value === event.target.value,
                  )
                  if (option) setShoppingCategory(option.value)
                }}
              >
                {categoryOptions.map(({ label, value }) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
          )}
        </div>
        {error && (
          <p className={styles.error} role="alert">
            {error}
          </p>
        )}
        <div className={styles.actions}>
          <button type="button" disabled={busy} onClick={onCancel}>
            Отмена
          </button>
          <button className={styles.save} type="submit" disabled={!canSave}>
            {busy
              ? 'Сохраняем…'
              : isTask
                ? 'Добавить задачу'
                : 'Добавить покупку'}
          </button>
        </div>
      </form>
    </PlannerDialog>
  )
}
