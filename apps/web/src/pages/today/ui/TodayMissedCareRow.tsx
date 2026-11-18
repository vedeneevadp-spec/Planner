import { useId, useState } from 'react'
import { Link } from 'react-router'

import { cx } from '@/shared/lib/classnames'
import { HeartIcon } from '@/shared/ui/Icon'

import type { TodayOverdueSelfCareGroup } from '../lib/today-self-care'
import styles from './TodayMissedCareRow.module.css'

interface TodayMissedCareRowProps {
  errorMessage?: string | null | undefined
  groups: TodayOverdueSelfCareGroup[]
  isReleasing: boolean
  onRelease: () => void
}

/**
 * Missed daily care in one quiet row at the end of «Требуют внимания».
 * A habit missed yesterday is the past, not a debt, so there are no counters
 * of misses — only what was missed and a way to let it go.
 */
export function TodayMissedCareRow({
  errorMessage,
  groups,
  isReleasing,
  onRelease,
}: TodayMissedCareRowProps) {
  const [isExpanded, setIsExpanded] = useState(false)
  const [isConfirming, setIsConfirming] = useState(false)
  const listId = useId()

  if (groups.length === 0) {
    return null
  }

  return (
    <div className={styles.row}>
      <div className={styles.header}>
        <button
          className={styles.summary}
          type="button"
          aria-controls={listId}
          aria-expanded={isExpanded}
          onClick={() => setIsExpanded((value) => !value)}
        >
          <span className={styles.icon} aria-hidden="true">
            <HeartIcon size={16} />
          </span>
          <span className={styles.text}>
            <span className={styles.title}>
              Пропущенная забота · {groups.length}
            </span>
            <span className={styles.subtitle}>Вчерашнее — уже прошлое</span>
          </span>
          <span
            className={cx(styles.chevron, isExpanded && styles.chevronExpanded)}
            aria-hidden="true"
          />
        </button>
        {isConfirming ? null : (
          <button
            className={styles.releaseButton}
            type="button"
            disabled={isReleasing}
            onClick={() => setIsConfirming(true)}
          >
            Отпустить
          </button>
        )}
      </div>

      {isConfirming ? (
        <div
          className={styles.confirm}
          role="group"
          aria-label="Отпустить пропущенную заботу"
        >
          <p className={styles.confirmText}>
            Отметить пропущенным всё, что не сделано до сегодня? В истории это
            останется.
          </p>
          <div className={styles.confirmActions}>
            <button
              className={styles.releaseButton}
              type="button"
              disabled={isReleasing}
              onClick={() => {
                onRelease()
                setIsConfirming(false)
              }}
            >
              Отпустить
            </button>
            <button
              className={styles.cancelButton}
              type="button"
              onClick={() => setIsConfirming(false)}
            >
              Не сейчас
            </button>
          </div>
        </div>
      ) : null}

      {errorMessage ? (
        <p className={styles.error} role="alert">
          {errorMessage}
        </p>
      ) : null}

      {isExpanded ? (
        <ul id={listId} className={styles.chips}>
          {groups.map((group) => (
            <li key={group.entry.item.id}>
              <Link
                className={styles.chip}
                to="/self-care"
                aria-label={`Открыть заботу: ${group.entry.item.title}`}
              >
                {group.entry.item.title}
              </Link>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  )
}
