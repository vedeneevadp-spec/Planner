import { type FormEvent, type PropsWithChildren, useMemo, useState } from 'react'

import { useSessionAuth } from '@/features/session'

import styles from './AuthGate.module.css'

type AuthMode = 'login' | 'magic_link' | 'register'
type AuthScreenMode = AuthMode | 'recover'

const AUTH_MODE_CONTENT: Record<
  AuthScreenMode,
  {
    badge: string
    copy: string
    pendingLabel: string
    submitLabel: string
    title: string
  }
> = {
  login: {
    badge: 'Password sign-in',
    copy: 'Войдите по email и паролю. Magic link оставлен как запасной вариант.',
    pendingLabel: 'Открываем сессию...',
    submitLabel: 'Войти',
    title: 'Откройте Planner по паролю',
  },
  magic_link: {
    badge: 'Magic link fallback',
    copy: 'Если пароль ещё не настроен или нужен быстрый вход с подтверждением через почту, используйте ссылку.',
    pendingLabel: 'Отправляем ссылку...',
    submitLabel: 'Отправить magic link',
    title: 'Войти по magic link',
  },
  register: {
    badge: 'Password sign-up',
    copy: 'Создайте email/password аккаунт. Если в проекте включено подтверждение email, сначала подтвердите почту, потом входите по паролю.',
    pendingLabel: 'Создаём аккаунт...',
    submitLabel: 'Зарегистрироваться',
    title: 'Зарегистрируйте парольный доступ',
  },
  recover: {
    badge: 'Password recovery',
    copy: 'Вы открыли recovery link из письма Supabase. Задайте новый пароль для этого аккаунта.',
    pendingLabel: 'Сохраняем пароль...',
    submitLabel: 'Обновить пароль',
    title: 'Задайте новый пароль',
  },
}

const AUTH_MODE_OPTIONS: Array<{ id: AuthMode; label: string }> = [
  { id: 'login', label: 'Войти' },
  { id: 'register', label: 'Регистрация' },
  { id: 'magic_link', label: 'Magic link' },
]

export function AuthGate({ children }: PropsWithChildren) {
  const {
    accessToken,
    email,
    isAuthEnabled,
    isLoading,
    isPasswordRecovery,
    requestPasswordReset,
    signInWithOtp,
    signInWithPassword,
    signUpWithPassword,
    updatePassword,
  } = useSessionAuth()
  const [mode, setMode] = useState<AuthMode>('login')
  const [formEmail, setFormEmail] = useState(email ?? '')
  const [displayName, setDisplayName] = useState('')
  const [password, setPassword] = useState('')
  const [passwordConfirmation, setPasswordConfirmation] = useState('')
  const [statusMessage, setStatusMessage] = useState<string | null>(null)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const defaultEmailDomain = useMemo(() => extractEmailDomain(email), [email])
  const screenMode: AuthScreenMode = isPasswordRecovery ? 'recover' : mode
  const modeContent = AUTH_MODE_CONTENT[screenMode]

  if (!isAuthEnabled || (accessToken && !isPasswordRecovery)) {
    return children
  }

  if (isLoading) {
    return (
      <section className={styles.shell}>
        <div className={styles.panel}>
          <div className={styles.hero}>
            <div>
              <p className={styles.eyebrow}>Supabase Auth</p>
              <h1 className={styles.title}>Поднимаем рабочую сессию.</h1>
              <p className={styles.copy}>
                Planner ждёт access token от Supabase, чтобы backend начал
                работать в authenticated runtime.
              </p>
            </div>
          </div>
          <div className={styles.formCard}>
            <div className={styles.loadingState}>
              <strong>Проверяем локальную auth-сессию</strong>
              <p>
                Если email/password или magic link уже открывали сессию в этом
                браузере, вход восстановится автоматически.
              </p>
            </div>
          </div>
        </div>
      </section>
    )
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()

    const normalizedEmail = formEmail.trim().toLowerCase()

    if (screenMode !== 'recover' && !normalizedEmail) {
      setErrorMessage(
        screenMode === 'magic_link'
          ? 'Укажите email, на который можно отправить magic link.'
          : 'Укажите email для входа.',
      )
      return
    }

    if (screenMode !== 'magic_link' && !password) {
      setErrorMessage('Введите пароль.')
      return
    }

    if (
      (screenMode === 'register' || screenMode === 'recover') &&
      password !== passwordConfirmation
    ) {
      setErrorMessage('Пароли не совпадают.')
      return
    }

    setIsSubmitting(true)
    setErrorMessage(null)
    setStatusMessage(null)

    try {
      if (screenMode === 'recover') {
        await updatePassword(password)
        clearSensitiveFields()
        setStatusMessage('Пароль обновлён. Открываем рабочую сессию...')
        return
      }

      if (screenMode === 'login') {
        await signInWithPassword(normalizedEmail, password)
        setStatusMessage('Сессия открывается...')
        return
      }

      if (screenMode === 'register') {
        const signUpResult = await signUpWithPassword({
          ...(displayName.trim() ? { displayName: displayName.trim() } : {}),
          email: normalizedEmail,
          password,
        })

        clearSensitiveFields()

        if (signUpResult.requiresEmailConfirmation) {
          setMode('login')
          setStatusMessage(
            `Аккаунт для ${normalizedEmail} создан. Подтвердите email через письмо, затем входите по паролю.`,
          )

          return
        }

        setStatusMessage('Аккаунт создан. Открываем рабочую сессию...')
        return
      }

      await signInWithOtp(normalizedEmail)
      clearSensitiveFields()
      setStatusMessage(
        `Magic link отправлен на ${normalizedEmail}. Откройте письмо и вернитесь в Planner.`,
      )
    } catch (error) {
      setErrorMessage(
        error instanceof Error ? error.message : 'Не удалось завершить auth flow.',
      )
    } finally {
      setIsSubmitting(false)
    }
  }

  function clearSensitiveFields() {
    setPassword('')
    setPasswordConfirmation('')
  }

  async function handlePasswordResetRequest() {
    const normalizedEmail = formEmail.trim().toLowerCase()

    if (!normalizedEmail) {
      setErrorMessage('Сначала укажите email для восстановления пароля.')
      return
    }

    setIsSubmitting(true)
    setErrorMessage(null)
    setStatusMessage(null)

    try {
      await requestPasswordReset(normalizedEmail)
      clearSensitiveFields()
      setStatusMessage(
        `Письмо для сброса пароля отправлено на ${normalizedEmail}. Откройте ссылку из письма и задайте новый пароль.`,
      )
    } catch (error) {
      setErrorMessage(
        error instanceof Error
          ? error.message
          : 'Не удалось отправить письмо для сброса пароля.',
      )
    } finally {
      setIsSubmitting(false)
    }
  }

  function handleModeChange(nextMode: AuthMode) {
    setMode(nextMode)
    setErrorMessage(null)
    setStatusMessage(null)
    clearSensitiveFields()

    if (nextMode !== 'register') {
      setDisplayName('')
    }
  }

  return (
    <section className={styles.shell}>
      <div className={styles.panel}>
        <div className={styles.hero}>
          <div>
            <p className={styles.eyebrow}>Planner Auth Cutover</p>
            <h1 className={styles.title}>Backend больше не доверяет заголовкам.</h1>
            <p className={styles.copy}>
              Вход теперь идёт через Supabase session. Основной поток теперь
              обычный email/password, а magic link остаётся fallback для
              подтверждения и аварийного входа.
            </p>
          </div>

          <div className={styles.heroFooter}>
            <div className={styles.heroMetric}>
              <span>Runtime</span>
              <strong>Supabase JWT + Fastify + RLS</strong>
            </div>
            <div className={styles.heroMetric}>
              <span>Redirect</span>
              <strong>{window.location.origin}</strong>
            </div>
            <div className={styles.heroMetric}>
              <span>Best for</span>
              <strong>{defaultEmailDomain ?? 'рабочий email с доступом к проекту'}</strong>
            </div>
          </div>
        </div>

        <div className={styles.formCard}>
          {!isPasswordRecovery ? (
            <div
              className={styles.modeSwitch}
              role="tablist"
              aria-label="Authentication mode"
            >
              {AUTH_MODE_OPTIONS.map((option) => (
                <button
                  key={option.id}
                  aria-selected={mode === option.id}
                  className={[
                    styles.modeButton,
                    mode === option.id ? styles.modeButtonActive : '',
                  ].join(' ')}
                  role="tab"
                  type="button"
                  onClick={() => handleModeChange(option.id)}
                >
                  {option.label}
                </button>
              ))}
            </div>
          ) : null}

          <span className={styles.statusBadge}>{modeContent.badge}</span>
          <h2 className={styles.formTitle}>{modeContent.title}</h2>
          <p className={styles.formCopy}>{modeContent.copy}</p>

          <form className={styles.form} onSubmit={(event) => void handleSubmit(event)}>
            {screenMode === 'register' ? (
              <label className={styles.field}>
                <span>Имя</span>
                <input
                  autoComplete="name"
                  placeholder="Как вас называть"
                  type="text"
                  value={displayName}
                  onChange={(event) => setDisplayName(event.target.value)}
                />
              </label>
            ) : null}

            {screenMode !== 'recover' ? (
              <label className={styles.field}>
                <span>Email</span>
                <input
                  autoComplete="email"
                  inputMode="email"
                  placeholder="name@company.com"
                  type="email"
                  value={formEmail}
                  onChange={(event) => setFormEmail(event.target.value)}
                />
              </label>
            ) : (
              <div className={styles.recoveryCard}>
                <span>Аккаунт для восстановления</span>
                <strong>{email ?? 'email из recovery session'}</strong>
              </div>
            )}

            {screenMode !== 'magic_link' ? (
              <label className={styles.field}>
                <span>{screenMode === 'recover' ? 'Новый пароль' : 'Пароль'}</span>
                <input
                  autoComplete={
                    screenMode === 'register' || screenMode === 'recover'
                      ? 'new-password'
                      : 'current-password'
                  }
                  placeholder={
                    screenMode === 'register' || screenMode === 'recover'
                      ? 'Придумайте пароль'
                      : 'Введите ваш пароль'
                  }
                  type="password"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                />
              </label>
            ) : null}

            {screenMode === 'register' || screenMode === 'recover' ? (
              <label className={styles.field}>
                <span>
                  {screenMode === 'recover'
                    ? 'Повторите новый пароль'
                    : 'Повторите пароль'}
                </span>
                <input
                  autoComplete="new-password"
                  placeholder={
                    screenMode === 'recover'
                      ? 'Повторите новый пароль'
                      : 'Повторите пароль'
                  }
                  type="password"
                  value={passwordConfirmation}
                  onChange={(event) => setPasswordConfirmation(event.target.value)}
                />
              </label>
            ) : null}

            <p className={styles.helperText}>
              {screenMode === 'login'
                ? 'После первого подтверждения email можно входить напрямую по паролю.'
                : screenMode === 'register'
                  ? 'Если в Supabase включено подтверждение email, после регистрации придёт письмо подтверждения.'
                  : screenMode === 'recover'
                    ? 'После сохранения нового пароля вход по email/password снова будет работать.'
                    : 'Используйте этот режим, если пароль ещё не настроен или нужен резервный вход.'}
            </p>

            {statusMessage ? <p className={styles.message}>{statusMessage}</p> : null}
            {errorMessage ? <p className={styles.error}>{errorMessage}</p> : null}

            <button
              className={styles.submitButton}
              disabled={isSubmitting}
              type="submit"
            >
              {isSubmitting ? modeContent.pendingLabel : modeContent.submitLabel}
            </button>

            {screenMode === 'login' ? (
              <button
                className={styles.tertiaryButton}
                disabled={isSubmitting}
                type="button"
                onClick={() => {
                  void handlePasswordResetRequest()
                }}
              >
                Забыли пароль?
              </button>
            ) : null}

            <button
              className={styles.secondaryButton}
              type="button"
              onClick={() => {
                setErrorMessage(null)
                setStatusMessage(null)
                clearSensitiveFields()

                if (screenMode === 'register') {
                  setDisplayName('')
                }
              }}
            >
              Очистить чувствительные поля
            </button>
          </form>
        </div>
      </div>
    </section>
  )
}

function extractEmailDomain(email: string | null): string | null {
  if (!email || !email.includes('@')) {
    return null
  }

  return email.split('@')[1] ?? null
}
