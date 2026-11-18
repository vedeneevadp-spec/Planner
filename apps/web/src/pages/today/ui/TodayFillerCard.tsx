import type { TodayFillerSummaryItem } from '../lib/today-filler'
import styles from './TodayFillerCard.module.css'

const ILLUSTRATIONS = {
  notebook: {
    dark: '/self-care/add-care/create-card-bg-dark.webp',
    light: '/self-care/add-care/create-card-bg-light.webp',
  },
  tea: {
    dark: '/self-care/today-clear-dark.webp',
    light: '/self-care/today-clear-light.webp',
  },
} as const

interface TodayFillerCardProps {
  illustration: keyof typeof ILLUSTRATIONS
  phrase: string
  summary: TodayFillerSummaryItem[]
}

/**
 * Fills the free space under the shorter column of a two-column row. It is
 * sized by the row, not by its content: CSS container queries decide whether
 * there is room for nothing, the phrase, the summary or the illustration.
 * Decorative and derived from what is already on the page, so it is hidden
 * from assistive tech.
 */
export function TodayFillerCard({
  illustration,
  phrase,
  summary,
}: TodayFillerCardProps) {
  const images = ILLUSTRATIONS[illustration]

  return (
    <div className={styles.slot} aria-hidden="true">
      <div className={styles.card}>
        <div className={styles.artwork}>
          <img
            className={`${styles.image} ${styles.imageLight}`}
            src={images.light}
            alt=""
            loading="lazy"
            decoding="async"
          />
          <img
            className={`${styles.image} ${styles.imageDark}`}
            src={images.dark}
            alt=""
            loading="lazy"
            decoding="async"
          />
        </div>
        <p className={styles.phrase}>{phrase}</p>
        {summary.length > 0 ? (
          <ul className={styles.summary}>
            {summary.map((item) => (
              <li key={item.kind} className={styles.summaryItem}>
                {formatSummaryItem(item)}
              </li>
            ))}
          </ul>
        ) : null}
      </div>
    </div>
  )
}

function formatSummaryItem(item: TodayFillerSummaryItem): string {
  if (item.kind === 'done') {
    return `Сегодня закрыто: ${item.count}`
  }

  if (item.kind === 'next') {
    return `Дальше в ${item.time}: ${item.title}`
  }

  return `Больше всего задач — «${item.name}»`
}
