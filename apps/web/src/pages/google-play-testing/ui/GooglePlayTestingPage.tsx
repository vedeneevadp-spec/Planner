import {
  googlePlayTestingInputSchema,
  type GooglePlayTestingState,
} from '@planner/contracts'
import { type FormEvent, useState } from 'react'

import { useGooglePlayTesting } from '@/features/google-play-testing/lib/hooks'
import styles from '@/features/google-play-testing/ui/GooglePlayTesting.module.css'
import { PageStateView } from '@/shared/ui/PageState'

export function GooglePlayTestingPage() {
  const testing = useGooglePlayTesting()
  const state = testing.query.data
  return (
    <section className={styles.page}>
      <header className={styles.header}>
        <p className={styles.eyebrow}>Новости · Android</p>
        <h1>Помогите Хаотике выйти в Google Play</h1>
        <p>
          Планнер проходит закрытое тестирование. Приглашаем попробовать задачи,
          покупки и домашние дела на Android и рассказать, что можно улучшить.
        </p>
      </header>
      {!testing.enabled ? (
        <PageStateView
          kind="offline"
          title="Для заявки нужен интернет"
          description="Подключитесь к сети и войдите в аккаунт, чтобы отправить заявку или проверить доступ."
        />
      ) : testing.query.isError ? (
        <PageStateView
          kind="error"
          title="Не удалось загрузить заявку"
          description="Попробуйте ещё раз. Ваша сохранённая заявка останется на месте."
          action={{
            label: 'Повторить',
            onClick: () => {
              void testing.query.refetch()
            },
          }}
        />
      ) : !state ? (
        <p role="status">Загружаем заявку…</p>
      ) : (
        <TestingApplication
          key={`${testing.session?.actorUserId}:${state.request?.revision ?? 0}`}
          state={state}
          submit={testing.submit.mutateAsync}
          busy={testing.submit.isPending}
        />
      )}
      <section className={styles.panel} aria-label="Как участвовать">
        <h2>Как присоединиться</h2>
        <ol className={styles.steps}>
          <li>
            Оставьте адрес Google-аккаунта, с которым вы пользуетесь Play
            Маркетом. Он может отличаться от почты в Хаотике.
          </li>
          <li>
            Дождитесь добавления в список тестировщиков. Статус и ссылки
            появятся на этой странице и в новости внутри планнера.
          </li>
          <li>
            Подключитесь к тесту, затем установите приложение из Google Play под
            тем же Google-аккаунтом.
          </li>
        </ol>
        <p className={styles.hint}>
          Пожалуйста, оставайтесь участником теста не менее 14 дней подряд и
          пользуйтесь планнером в обычных делах. Нужен телефон на Android.
        </p>
      </section>
      <section className={styles.panel}>
        <h2>Что попробовать</h2>
        <p>
          Создайте и завершите задачу, перенесите её на другой день, составьте
          список покупок и настройте напоминание.
        </p>
        <p>
          Если что-то не работает или неудобно, напишите на{' '}
          <a
            className={styles.link}
            href="mailto:support@chaotika.ru?subject=Google%20Play%20%E2%80%94%20%D0%BE%D1%82%D0%B7%D1%8B%D0%B2"
          >
            support@chaotika.ru
          </a>
          : модель телефона, ваши действия и результат. Новости теста — в{' '}
          <a
            className={styles.link}
            href="https://t.me/plan_chaosa"
            target="_blank"
            rel="noopener noreferrer"
          >
            Telegram-канале
          </a>
          .
        </p>
      </section>
    </section>
  )
}

function TestingApplication({
  state,
  submit,
  busy,
}: {
  state: GooglePlayTestingState
  submit: (email: string) => Promise<unknown>
  busy: boolean
}) {
  const [email, setEmail] = useState(state.request?.googleEmail ?? '')
  const [editing, setEditing] = useState(!state.request)
  const [error, setError] = useState<string | null>(null)
  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const parsed = googlePlayTestingInputSchema.safeParse({
      googleEmail: email,
    })
    if (!parsed.success) {
      setError('Укажите корректный адрес Google-аккаунта.')
      return
    }
    setError(null)
    try {
      await submit(parsed.data.googleEmail)
      setEditing(false)
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : 'Не удалось отправить заявку. Попробуйте ещё раз.',
      )
    }
  }
  return (
    <section className={styles.panel} aria-label="Моя заявка">
      <h2>
        {state.request?.status === 'invited'
          ? 'Доступ открыт — можно устанавливать'
          : state.request
            ? 'Заявка принята'
            : state.isOpen
              ? 'Хочу участвовать'
              : 'Набор участников пока закрыт'}
      </h2>
      {state.request && (
        <>
          <p className={styles.email}>
            Google-аккаунт: <strong>{state.request.googleEmail}</strong>
          </p>
          {state.request.status === 'pending' && (
            <p role="status">
              Ожидаем добавления адреса в Google Play. Вернитесь сюда позже —
              статус обновляется автоматически.
            </p>
          )}
        </>
      )}
      {state.invitation && (
        <>
          <p>
            Откройте ссылки под указанным Google-аккаунтом. Сначала подтвердите
            участие, затем переходите к установке.
          </p>
          <div className={styles.actions}>
            <a
              className={styles.primaryButton}
              href={state.invitation.joinUrl}
              target="_blank"
              rel="noopener noreferrer"
            >
              1. Подключиться к тесту
            </a>
            <a
              className={styles.button}
              href={state.invitation.downloadUrl}
              target="_blank"
              rel="noopener noreferrer"
            >
              2. Установить из Google Play
            </a>
          </div>
          <p className={styles.hint}>
            Если Google Play сообщает, что приложение недоступно, проверьте
            выбранный аккаунт и подтверждение участия. После добавления адреса
            доступ может появиться не сразу.
          </p>
        </>
      )}
      {!state.isOpen && (
        <p>
          Новые заявки сейчас не принимаются. Уже выданные ссылки остаются
          доступны.
        </p>
      )}
      {state.isOpen && editing && (
        <form
          className={styles.confirmation}
          onSubmit={(event) => {
            void handleSubmit(event)
          }}
        >
          <label className={styles.field}>
            Почта Google-аккаунта
            <input
              type="email"
              inputMode="email"
              autoComplete="email"
              maxLength={254}
              required
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              aria-describedby="testing-email-help"
              disabled={busy}
            />
          </label>
          <p id="testing-email-help" className={styles.hint}>
            Адрес видят только администраторы. Он нужен для добавления в
            закрытый тест Google Play.{' '}
            {state.request &&
              'При смене адреса понадобится новое подтверждение доступа.'}
          </p>
          <div className={styles.actions}>
            <button
              className={styles.primaryButton}
              type="submit"
              disabled={busy}
            >
              {busy
                ? 'Сохраняем…'
                : state.request
                  ? 'Сохранить адрес'
                  : 'Отправить заявку'}
            </button>
            {state.request && (
              <button
                className={styles.button}
                type="button"
                disabled={busy}
                onClick={() => setEditing(false)}
              >
                Отмена
              </button>
            )}
          </div>
        </form>
      )}
      {state.isOpen && !editing && (
        <button
          type="button"
          className={styles.button}
          onClick={() => setEditing(true)}
        >
          Изменить Google-почту
        </button>
      )}
      {error && (
        <p role="alert" className={styles.error}>
          {error}
        </p>
      )}
    </section>
  )
}
