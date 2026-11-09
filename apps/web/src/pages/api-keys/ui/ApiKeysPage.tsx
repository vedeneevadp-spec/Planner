import {
  type ApiKeyRecord,
  type ApiKeyScope,
  type SessionResponse,
} from '@planner/contracts'
import { useQuery } from '@tanstack/react-query'
import { type FormEvent, useEffect, useState } from 'react'
import { Link } from 'react-router'

import { createApiKeyClient } from '@/features/api-keys'
import { useSessionFeatureReadiness } from '@/features/session'
import type { ApiClientConfig } from '@/shared/lib/api-client'
import { cx } from '@/shared/lib/classnames'
import { useBrowserOffline } from '@/shared/lib/offline-sync'
import pageStyles from '@/shared/ui/Page'
import { PageStateView } from '@/shared/ui/PageState'

import styles from './ApiKeysPage.module.css'

const scopes: Array<{ value: ApiKeyScope; label: string }> = [
  { value: 'tasks:read', label: 'Читать задачи' },
  { value: 'tasks:write', label: 'Создавать и изменять задачи' },
  { value: 'shopping:read', label: 'Читать покупки' },
  { value: 'shopping:write', label: 'Добавлять и изменять покупки' },
]

export function ApiKeysPage() {
  const { apiConfig, session, readiness } = useSessionFeatureReadiness()
  if (!session || !apiConfig) {
    return (
      <PageStateView
        kind="loading"
        title="Загружаем настройки интеграций"
        description="Подключитесь к интернету и войдите в аккаунт."
      />
    )
  }
  return (
    <ApiKeysPanel
      key={`${session.actorUserId}:${session.workspaceId}`}
      config={apiConfig}
      session={session}
      enabled={
        readiness.canWriteProtectedData && Boolean(apiConfig.accessToken)
      }
    />
  )
}

function ApiKeysPanel({
  config,
  session,
  enabled,
}: {
  config: ApiClientConfig
  session: SessionResponse
  enabled: boolean
}) {
  const offline = useBrowserOffline()
  const disabled = !enabled || offline
  const client = createApiKeyClient(config)
  const query = useQuery({
    queryKey: ['api-keys', session.actorUserId],
    queryFn: ({ signal }) => client.list(signal),
    enabled: !disabled,
    gcTime: 0,
    retry: false,
  })
  const [name, setName] = useState('')
  const [selectedScopes, setSelectedScopes] = useState<ApiKeyScope[]>([
    'tasks:read',
    'shopping:read',
  ])
  const [expiresInDays, setExpiresInDays] = useState(90)
  const [created, setCreated] = useState<{
    key: ApiKeyRecord
    secret: string
  } | null>(null)
  const [busy, setBusy] = useState(false)
  const [now, setNow] = useState(Date.now)
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 60_000)
    return () => window.clearInterval(timer)
  }, [])
  const [feedback, setFeedback] = useState<{
    error: boolean
    text: string
  } | null>(null)
  const baseUrl = config.apiBaseUrl.replace(/\/$/, '')
  const formatDate = (date: string) =>
    new Intl.DateTimeFormat('ru-RU', {
      dateStyle: 'medium',
      timeZone: config.clientTimeZone ?? 'UTC',
    }).format(new Date(date))

  async function create(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (disabled || busy || created) return
    setBusy(true)
    setFeedback(null)
    try {
      const result = await client.create({
        name,
        scopes: selectedScopes,
        expiresInDays,
      })
      setCreated(result)
      setName('')
      await query.refetch()
    } catch (error) {
      setFeedback({
        error: true,
        text:
          error instanceof Error
            ? error.message
            : 'Не удалось создать ключ. Повторите попытку.',
      })
    } finally {
      setBusy(false)
    }
  }
  async function revoke(key: ApiKeyRecord) {
    if (disabled || busy) return
    setBusy(true)
    setFeedback(null)
    try {
      await client.revoke(key.id)
      if (created?.key.id === key.id) setCreated(null)
      setFeedback({ error: false, text: `Ключ «${key.name}» отозван.` })
      await query.refetch()
    } catch {
      setFeedback({
        error: true,
        text: 'Не удалось отозвать ключ. Повторите попытку.',
      })
    } finally {
      setBusy(false)
    }
  }
  async function copy() {
    if (!created) return
    try {
      await navigator.clipboard.writeText(created.secret)
      setFeedback({ error: false, text: 'Ключ скопирован.' })
    } catch {
      setFeedback({ error: true, text: 'Выделите и скопируйте ключ вручную.' })
    }
  }

  return (
    <div className={cx(pageStyles.page, styles.page)}>
      <Link className={styles.back} to="/more">
        ← Настройки
      </Link>
      <header className={styles.header}>
        <h1>API и интеграции</h1>
        <p>
          Подключайте свои скрипты, ботов и автоматизации к задачам и покупкам.
        </p>
      </header>
      {disabled ? (
        <p className={styles.notice} role="status">
          {offline
            ? 'Для управления ключами подключитесь к интернету.'
            : 'API-ключи доступны после входа в аккаунт.'}
        </p>
      ) : null}
      {feedback ? (
        <p
          className={feedback.error ? styles.error : styles.notice}
          role={feedback.error ? 'alert' : 'status'}
        >
          {feedback.text}
        </p>
      ) : null}

      {created ? (
        <section
          className={cx(styles.panel, styles.secretPanel)}
          aria-labelledby="api-key-created"
        >
          <h2 id="api-key-created">Ключ «{created.key.name}» создан</h2>
          <p>
            Скопируйте его сейчас. После закрытия этого блока увидеть ключ снова
            нельзя.
          </p>
          <label className={styles.field}>
            Ваш API-ключ
            <input
              aria-label="Ваш API-ключ"
              autoComplete="off"
              readOnly
              value={created.secret}
              onFocus={(event) => event.currentTarget.select()}
            />
          </label>
          <div className={styles.actions}>
            <button
              className={styles.primaryButton}
              type="button"
              onClick={() => void copy()}
            >
              Скопировать
            </button>
            <button
              className={styles.button}
              type="button"
              onClick={() => setCreated(null)}
            >
              Ключ сохранён
            </button>
          </div>
          <p className={styles.note}>
            Храните ключ в секретах вашей автоматизации. Он даёт выбранный
            доступ к данным пространства «{session.workspace.name}».
          </p>
        </section>
      ) : null}

      <form className={styles.panel} onSubmit={(event) => void create(event)}>
        <h2>Новый ключ</h2>
        <p>
          Пространство: <strong>{session.workspace.name}</strong>. Чтобы выдать
          доступ к другому пространству, сначала переключитесь на него.
        </p>
        <fieldset
          className={styles.formFields}
          disabled={disabled || busy || Boolean(created)}
        >
          <legend className={pageStyles.visuallyHidden}>
            Параметры API-ключа
          </legend>
          <label className={styles.field}>
            Название
            <input
              required
              maxLength={80}
              value={name}
              placeholder="Например, мой Telegram-бот"
              onChange={(event) => setName(event.target.value)}
            />
          </label>
          <label className={styles.field}>
            Срок действия
            <select
              value={expiresInDays}
              onChange={(event) => setExpiresInDays(Number(event.target.value))}
            >
              <option value={30}>30 дней</option>
              <option value={90}>90 дней</option>
              <option value={365}>1 год</option>
            </select>
          </label>
          <fieldset className={styles.permissions}>
            <legend>Разрешения</legend>
            {scopes.map((scope) => (
              <label key={scope.value}>
                <input
                  type="checkbox"
                  checked={selectedScopes.includes(scope.value)}
                  onChange={(event) =>
                    setSelectedScopes((current) =>
                      event.target.checked
                        ? [...current, scope.value]
                        : current.filter((value) => value !== scope.value),
                    )
                  }
                />
                <span>{scope.label}</span>
              </label>
            ))}
          </fieldset>
          <button
            className={styles.primaryButton}
            disabled={!name.trim() || !selectedScopes.length}
            type="submit"
          >
            {busy ? 'Подождите…' : 'Создать ключ'}
          </button>
        </fieldset>
      </form>

      <section className={styles.panel} aria-labelledby="api-keys-list">
        <h2 id="api-keys-list">Ваши ключи</h2>
        <p className={styles.note}>
          Ключи всех ваших пространств. Отзыв сразу останавливает последующие
          запросы интеграции.
        </p>
        {!disabled && query.isPending ? (
          <p role="status">Загружаем ключи…</p>
        ) : null}
        {query.isError ? (
          <div role="alert">
            <p>Не удалось загрузить ключи.</p>
            <button
              className={styles.button}
              type="button"
              disabled={disabled || busy}
              onClick={() => void query.refetch()}
            >
              Повторить
            </button>
          </div>
        ) : null}
        {query.data?.keys.length === 0 ? (
          <p>Пока нет ключей. Создайте первый для своей интеграции.</p>
        ) : null}
        <ul className={styles.keyList}>
          {query.data?.keys.map((key) => {
            const expired = Date.parse(key.expiresAt) <= now
            const workspace = session.workspaces.find(
              (item) => item.id === key.workspaceId,
            )
            return (
              <li className={styles.key} key={key.id}>
                <div className={styles.keyHeading}>
                  <strong>{key.name}</strong>
                  <span className={styles.badge}>
                    {key.revokedAt
                      ? 'Отозван'
                      : expired
                        ? 'Истёк'
                        : 'Действует'}
                  </span>
                </div>
                <code>{key.prefix}…</code>
                <p>
                  {workspace?.name ?? 'Недоступное пространство'} · до{' '}
                  {formatDate(key.expiresAt)}
                </p>
                <p className={styles.note}>
                  {key.scopes
                    .map(
                      (value) =>
                        scopes.find((scope) => scope.value === value)?.label,
                    )
                    .join(' · ')}
                </p>
                <p className={styles.note}>
                  Последнее использование:{' '}
                  {key.lastUsedAt
                    ? formatDate(key.lastUsedAt)
                    : 'ещё не использовался'}
                </p>
                {!key.revokedAt && !expired ? (
                  <button
                    className={styles.button}
                    type="button"
                    disabled={disabled || busy}
                    aria-label={`Отозвать ключ ${key.name}`}
                    onClick={() => void revoke(key)}
                  >
                    Отозвать ключ
                  </button>
                ) : null}
              </li>
            )
          })}
        </ul>
      </section>
      <section className={styles.panel} aria-labelledby="api-quickstart">
        <h2 id="api-quickstart">Первый запрос</h2>
        <p>
          Сохраните ключ в переменную окружения <code>HAOTIKA_API_KEY</code>.
          Этот пример читает первые 10 задач и требует разрешения «Читать
          задачи».
        </p>
        <pre className={styles.code}>
          <code>{`curl "${baseUrl}/api/public/v1/tasks?limit=10" \\\n  -H "Authorization: Bearer $HAOTIKA_API_KEY"`}</code>
        </pre>
        <a
          className={styles.back}
          href={`${baseUrl}/api/docs/#/integrations`}
          target="_blank"
          rel="noreferrer"
        >
          Документация API и примеры →
        </a>
      </section>
    </div>
  )
}
