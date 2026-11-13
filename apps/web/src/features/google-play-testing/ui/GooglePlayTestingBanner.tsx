import { useState } from 'react'
import { Link, useLocation } from 'react-router'

import { GOOGLE_PLAY_TESTING_PATH } from '../lib/content'
import { useGooglePlayTesting } from '../lib/hooks'
import styles from './GooglePlayTesting.module.css'

export function GooglePlayTestingBanner() {
  const { query, session, enabled } = useGooglePlayTesting()
  const location = useLocation()
  const state = query.data
  const status = state?.request?.status ?? 'new'
  const key = `chaotika:google-play-testing:${session?.actorUserId}:${status}:${state?.request?.revision ?? 0}`
  const [dismissed, setDismissed] = useState<string | null>(null)
  let isHidden = dismissed === key
  try {
    isHidden ||= localStorage.getItem(key) === 'hidden'
  } catch {
    /* Storage may be unavailable. */
  }
  if (
    !enabled ||
    !state ||
    (!state.isOpen && !state.request) ||
    isHidden ||
    location.pathname === GOOGLE_PLAY_TESTING_PATH
  )
    return null

  function dismiss() {
    setDismissed(key)
    try {
      localStorage.setItem(key, 'hidden')
    } catch {
      /* Keep dismissal for this session. */
    }
  }
  return (
    <aside className={styles.banner} aria-label="Новости Хаотики">
      <div className={styles.bannerCopy}>
        <strong>
          {status === 'invited'
            ? 'Вам открыт доступ к тесту Google Play'
            : status === 'pending'
              ? 'Заявка на тест Google Play принята'
              : 'Хаотика тестируется в Google Play'}
        </strong>
        <span>
          {status === 'invited'
            ? 'Подключитесь к тесту и установите приложение на Android.'
            : status === 'pending'
              ? 'Здесь можно проверить статус и получить ссылки для установки.'
              : 'Нужна ваша помощь: попробуйте планнер на Android и поделитесь впечатлениями.'}
        </span>
      </div>
      <Link className={styles.button} to={GOOGLE_PLAY_TESTING_PATH}>
        {status === 'invited'
          ? 'Получить ссылки'
          : status === 'pending'
            ? 'Моя заявка'
            : 'Помочь с тестом'}
      </Link>
      <button
        className={styles.dismiss}
        type="button"
        onClick={dismiss}
        aria-label="Скрыть новость о Google Play"
      >
        ×
      </button>
    </aside>
  )
}
