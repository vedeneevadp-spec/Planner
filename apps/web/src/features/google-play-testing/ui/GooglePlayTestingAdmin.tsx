import type { GooglePlayTestingRequest } from '@planner/contracts'
import { useState } from 'react'
import { Link } from 'react-router'

import {
  GOOGLE_PLAY_TELEGRAM_POST,
  GOOGLE_PLAY_TESTING_PATH,
} from '../lib/content'
import { useGooglePlayTestingAdmin } from '../lib/hooks'
import styles from './GooglePlayTesting.module.css'

export function GooglePlayTestingAdmin() {
  const testing = useGooglePlayTestingAdmin()
  const [filter, setFilter] = useState<'pending' | 'invited' | 'all'>('pending')
  const [notice, setNotice] = useState<string | null>(null)
  const data = testing.query.data
  const busy =
    !testing.enabled || testing.settings.isPending || testing.review.isPending
  const pending =
    data?.requests.filter((request) => request.status === 'pending') ?? []
  const requests =
    data?.requests.filter(
      (request) => filter === 'all' || request.status === filter,
    ) ?? []
  async function copy(text: string) {
    try {
      await navigator.clipboard.writeText(text)
      setNotice('Скопировано.')
    } catch {
      setNotice(
        'Не удалось скопировать автоматически. Выделите текст и скопируйте его вручную.',
      )
    }
  }
  return (
    <section className={styles.page} aria-label="Тестирование Google Play">
      <div className={styles.panel}>
        <h2>Приглашение в тест Google Play</h2>
        <p>
          Объявление ведёт на форму заявки. После добавления Google-почты в
          список Alpha откройте участнику ссылки здесь.
        </p>
        {testing.query.isError && (
          <p role="alert">
            Не удалось загрузить заявки.{' '}
            <button
              className={styles.button}
              type="button"
              onClick={() => {
                void testing.query.refetch()
              }}
            >
              Повторить
            </button>
          </p>
        )}
        {!testing.enabled && (
          <p role="status">Для управления тестом подключитесь к интернету.</p>
        )}
        {testing.query.isPending && testing.enabled && (
          <p role="status">Загружаем заявки…</p>
        )}
        {data && (
          <>
            <p className={styles.status}>
              {data.isOpen
                ? 'Объявление показывается, заявки принимаются.'
                : 'Объявление скрыто, приём новых заявок закрыт.'}
            </p>
            <div className={styles.actions}>
              <button
                className={styles.primaryButton}
                disabled={busy}
                type="button"
                onClick={() => testing.settings.mutate(!data.isOpen)}
              >
                {data.isOpen
                  ? 'Скрыть объявление и закрыть набор'
                  : 'Показать объявление и открыть набор'}
              </button>
              <Link className={styles.button} to={GOOGLE_PLAY_TESTING_PATH}>
                Посмотреть страницу участия
              </Link>
            </div>
            <p className={styles.hint}>
              Статус сохранённых заявок и уже выданные ссылки доступны и после
              закрытия набора.
            </p>
          </>
        )}
        {testing.settings.error && (
          <p role="alert" className={styles.error}>
            {testing.settings.error.message}
          </p>
        )}
      </div>
      {data && (
        <section className={styles.panel}>
          <h2>Заявки: {data.requests.length}</h2>
          <p>
            Ожидают: {pending.length}. Доступ выдан:{' '}
            {data.requests.length - pending.length}.
          </p>
          <p className={styles.hint}>
            Это статусы заявок в Хаотике. Фактическое участие и срок
            тестирования проверяйте в Google Play Console.
          </p>
          <ol className={styles.steps}>
            <li>
              Скопируйте адрес и добавьте его в список тестировщиков Alpha в{' '}
              <a
                className={styles.link}
                href="https://play.google.com/console/"
                target="_blank"
                rel="noopener noreferrer"
              >
                Google Play Console
              </a>
              . Сохраните список.
            </li>
            <li>
              Нажмите «Открыть доступ» у соответствующей заявки. Участник увидит
              ссылки в планнере.
            </li>
          </ol>
          <div className={styles.actions} aria-label="Фильтр заявок">
            <button
              className={styles.button}
              type="button"
              aria-pressed={filter === 'pending'}
              onClick={() => setFilter('pending')}
            >
              Ожидают
            </button>
            <button
              className={styles.button}
              type="button"
              aria-pressed={filter === 'invited'}
              onClick={() => setFilter('invited')}
            >
              Доступ выдан
            </button>
            <button
              className={styles.button}
              type="button"
              aria-pressed={filter === 'all'}
              onClick={() => setFilter('all')}
            >
              Все
            </button>
          </div>
          {pending.length > 0 && (
            <button
              className={styles.button}
              type="button"
              onClick={() => {
                void copy(
                  [
                    ...new Set(pending.map((request) => request.googleEmail)),
                  ].join('\n'),
                )
              }}
            >
              Скопировать ожидающие адреса
            </button>
          )}
          {requests.length === 0 && <p>В этом списке пока нет заявок.</p>}
          <ul className={styles.requestList}>
            {requests.map((request) => (
              <TestingRequest
                key={`${request.userId}:${request.revision}`}
                request={request}
                disabled={busy}
                copy={copy}
                review={async (status) => {
                  await testing.review.mutateAsync({
                    userId: request.userId,
                    revision: request.revision,
                    status,
                  })
                }}
              />
            ))}
          </ul>
          {testing.review.error && (
            <p role="alert" className={styles.error}>
              {testing.review.error.message}
            </p>
          )}
        </section>
      )}
      <section className={styles.panel}>
        <h2>Приглашение для Telegram</h2>
        <p>
          Текст для канала{' '}
          <a
            className={styles.link}
            href="https://t.me/plan_chaosa"
            target="_blank"
            rel="noopener noreferrer"
          >
            @plan_chaosa
          </a>
          . Ссылка ведёт на ту же форму в планнере. Перед публикацией откройте
          набор.
        </p>
        <label className={styles.field}>
          Текст поста
          <textarea
            className={styles.post}
            readOnly
            value={GOOGLE_PLAY_TELEGRAM_POST}
          />
        </label>
        <button
          className={styles.button}
          type="button"
          onClick={() => {
            void copy(GOOGLE_PLAY_TELEGRAM_POST)
          }}
        >
          Скопировать пост для Telegram
        </button>
      </section>
      {notice && (
        <p role="status" className={styles.status}>
          {notice}
        </p>
      )}
    </section>
  )
}

function TestingRequest({
  request,
  disabled,
  copy,
  review,
}: {
  request: GooglePlayTestingRequest
  disabled: boolean
  copy: (text: string) => Promise<void>
  review: (status: GooglePlayTestingRequest['status']) => Promise<void>
}) {
  const [confirming, setConfirming] = useState(false)
  const [checked, setChecked] = useState(false)
  async function approve() {
    try {
      await review('invited')
      setConfirming(false)
    } catch {
      /* Parent shows the mutation error. */
    }
  }
  return (
    <li className={styles.request}>
      <strong className={styles.email}>{request.googleEmail}</strong>
      <span className={styles.hint}>
        {request.status === 'pending'
          ? 'Ожидает добавления'
          : 'Ссылки доступны участнику'}
      </span>
      <div className={styles.actions}>
        <button
          className={styles.button}
          type="button"
          onClick={() => {
            void copy(request.googleEmail)
          }}
        >
          Скопировать почту
        </button>
        {request.status === 'pending' && !confirming && (
          <button
            className={styles.primaryButton}
            disabled={disabled}
            type="button"
            onClick={() => setConfirming(true)}
          >
            Открыть доступ
          </button>
        )}
        {request.status === 'invited' && (
          <button
            className={styles.button}
            disabled={disabled}
            type="button"
            onClick={() => {
              void review('pending').catch(() => undefined)
            }}
          >
            Вернуть в ожидающие
          </button>
        )}
      </div>
      {confirming && (
        <div className={styles.confirmation}>
          <label className={styles.check}>
            <input
              type="checkbox"
              checked={checked}
              onChange={(event) => setChecked(event.target.checked)}
            />
            Адрес {request.googleEmail} добавлен в список Alpha, изменения
            сохранены в Google Play Console.
          </label>
          <div className={styles.actions}>
            <button
              className={styles.primaryButton}
              type="button"
              disabled={disabled || !checked}
              onClick={() => {
                void approve()
              }}
            >
              Подтвердить и показать ссылки
            </button>
            <button
              className={styles.button}
              type="button"
              disabled={disabled}
              onClick={() => {
                setConfirming(false)
                setChecked(false)
              }}
            >
              Отмена
            </button>
          </div>
        </div>
      )}
    </li>
  )
}
