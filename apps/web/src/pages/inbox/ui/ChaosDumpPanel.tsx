import { type FormEvent, useMemo, useState } from 'react'

import { usePlannerApiClient } from '@/features/planner'

import { MAX_CHAOS_TEXT_LENGTH, parseChaosDump } from '../lib/chaos-dump'
import styles from './ChaosDumpPanel.module.css'

interface ChaosDumpPanelProps {
  onSaved?: (() => void) | undefined
}

export function ChaosDumpPanel({ onSaved }: ChaosDumpPanelProps) {
  const api = usePlannerApiClient()
  const [text, setText] = useState('')
  const [splitByLines, setSplitByLines] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [isSaving, setIsSaving] = useState(false)
  const parsedPreview = useMemo(
    () => parseChaosDump(text, { splitByLines }),
    [splitByLines, text],
  )
  const previewCount = parsedPreview.error ? 0 : parsedPreview.items.length
  const hasText = text.trim().length > 0

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError(null)
    setNotice(null)

    const parsed = parseChaosDump(text, { splitByLines })

    if (parsed.error) {
      setError(parsed.error)
      return
    }

    setIsSaving(true)

    try {
      const result = await api?.createChaosInboxItems({
        items: parsed.items.map((item) => ({
          source: 'manual',
          text: item,
        })),
      })
      const createdCount = result?.items.length ?? 0

      if (createdCount === parsed.items.length) {
        setText('')
        setNotice(
          createdCount === 1
            ? 'Один элемент ушел в хаос-входящие.'
            : `${createdCount} элементов ушли в хаос-входящие.`,
        )
        onSaved?.()
        return
      }

      setNotice(
        `Сохранено ${createdCount} из ${parsed.items.length}. Проверь соединение и повтори оставшееся.`,
      )
    } finally {
      setIsSaving(false)
    }
  }

  return (
    <section className={styles.panel} aria-labelledby="chaos-dump-title">
      <div className={styles.header}>
        <div>
          <p className={styles.eyebrow}>Сброс хаоса</p>
          <h3 id="chaos-dump-title">Пиши как думаешь</h3>
        </div>
        <span className={styles.counter}>
          {text.length}/{MAX_CHAOS_TEXT_LENGTH}
        </span>
      </div>

      <form
        className={styles.form}
        onSubmit={(event) => {
          void handleSubmit(event)
        }}
      >
        <label className={styles.textareaField}>
          <span>Сырые мысли, дела, тревоги, покупки</span>
          <textarea
            value={text}
            maxLength={MAX_CHAOS_TEXT_LENGTH}
            placeholder="купить корм\nзаписать ребенка к врачу\nответить клиенту\nкажется, я вообще ничего не успеваю"
            rows={7}
            onChange={(event) => {
              setText(event.target.value)
              setError(null)
              setNotice(null)
            }}
          />
        </label>

        <div className={styles.controlsRow}>
          <label className={styles.toggleControl}>
            <input
              type="checkbox"
              checked={splitByLines}
              onChange={(event) => setSplitByLines(event.target.checked)}
            />
            <span>Разделять по строкам</span>
          </label>

          <span className={styles.previewCount}>
            {hasText
              ? `${previewCount} ${previewCount === 1 ? 'элемент' : 'элементов'} к сохранению`
              : 'Пиши как думаешь. Разберем потом.'}
          </span>
        </div>

        {error ? <p className={styles.errorMessage}>{error}</p> : null}
        {notice ? <p className={styles.noticeMessage}>{notice}</p> : null}

        <div className={styles.footerRow}>
          <p>
            Никаких обязательных сфер, дат и приоритетов. Все попадет в Inbox
            без даты.
          </p>
          <button
            className={styles.primaryButton}
            type="submit"
            disabled={isSaving || !api}
          >
            {isSaving ? 'Сохраняю...' : 'Сохранить'}
          </button>
        </div>
      </form>
    </section>
  )
}
