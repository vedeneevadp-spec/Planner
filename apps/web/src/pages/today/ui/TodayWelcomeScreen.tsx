import { useId } from 'react'
import { useSearchParams } from 'react-router'

import { ChecklistIcon } from '@/shared/ui/Icon'
import pageStyles from '@/shared/ui/Page'

import styles from './TodayWelcomeScreen.module.css'

export function TodayWelcomeScreen({
  isSharedWorkspace,
}: {
  isSharedWorkspace: boolean
}) {
  const titleId = useId()
  const [, setSearchParams] = useSearchParams()

  function createTask() {
    setSearchParams((current) => {
      const next = new URLSearchParams(current)
      next.set('createTask', crypto.randomUUID())
      return next
    })
  }

  return (
    <section
      aria-labelledby={titleId}
      className={`${pageStyles.emptyPanel} ${styles.welcome}`}
    >
      <span className={styles.icon} aria-hidden="true">
        <ChecklistIcon size={32} strokeWidth={1.6} />
      </span>
      <h2 className={styles.title} id={titleId}>
        {isSharedWorkspace
          ? 'Начните с общей задачи'
          : 'Добро пожаловать в Хаотику'}
      </h2>
      <p className={styles.description}>
        {isSharedWorkspace
          ? 'Здесь будут ваши общие дела. Добавьте первую задачу, чтобы спланировать её вместе.'
          : 'Начни с одного небольшого дела. Запиши задачу, выбери дату или оставь её без срока.'}
      </p>
      <button
        className={styles.createButton}
        onClick={createTask}
        type="button"
      >
        <span aria-hidden="true">＋</span>
        Создать задачу
      </button>
      <p className={styles.hint}>
        Достаточно названия. Остальное можно добавить позже.
      </p>
    </section>
  )
}
