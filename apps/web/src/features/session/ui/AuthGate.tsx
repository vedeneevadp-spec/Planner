import {
  type FormEvent,
  type PropsWithChildren,
  type ReactNode,
  useEffect,
  useRef,
  useState,
} from 'react'

import { plannerApiConfig } from '@/shared/config/planner-api'

import {
  type AuthFieldErrors,
  type AuthFieldName,
  type AuthMode,
  type AuthScreenMode,
  getFriendlyAuthErrorMessage,
  getFriendlyPlannerSessionErrorMessage,
  isValidAuthEmail,
  omitAuthFieldError,
  validateAuthForm,
} from '../lib/auth-form'
import {
  getRememberSessionPreference,
  setRememberSessionPreference,
} from '../lib/auth-session-storage'
import { isNativeSessionPersistenceRuntime } from '../lib/native-session-storage'
import { isUnauthorizedSessionApiError } from '../lib/session-api'
import { canBootstrapPlannerSession } from '../lib/session-bootstrap'
import { usePlannerSession } from '../lib/usePlannerSession'
import { useSessionAuth } from '../lib/useSessionAuth'
import { resolveAuthGateView } from './AuthGate.model'
import styles from './AuthGate.module.css'

const AUTH_MODE_CONTENT: Record<
  AuthScreenMode,
  {
    copy: string
    helper: string
    pendingLabel: string
    submitLabel: string
    title: string
  }
> = {
  login: {
    copy: 'Введите email и пароль, чтобы продолжить работу.',
    helper: 'Безопасный вход по email и паролю.',
    pendingLabel: 'Входим...',
    submitLabel: 'Войти',
    title: 'Войдите в Chaotika',
  },
  register: {
    copy: 'Зарегистрируйтесь и начните собирать свои дела, списки и планы в одном месте.',
    helper: 'Аккаунт создается сразу и защищается паролем.',
    pendingLabel: 'Создаем аккаунт...',
    submitLabel: 'Создать аккаунт',
    title: 'Создайте аккаунт',
  },
  recover: {
    copy: 'Задайте новый пароль, чтобы снова войти в Chaotika.',
    helper:
      'После сохранения нового пароля вход по email и паролю снова будет доступен.',
    pendingLabel: 'Сохраняем пароль...',
    submitLabel: 'Сохранить пароль',
    title: 'Обновите пароль',
  },
}

const AUTH_MODE_OPTIONS: Array<{ id: AuthMode; label: string }> = [
  { id: 'login', label: 'Вход' },
  { id: 'register', label: 'Регистрация' },
]

const HERO_FEATURES = [
  {
    title: 'Собирайте все дела в одном месте',
    copy: 'Задачи, покупки, заметки и бытовые мелочи не расползаются по разным спискам.',
  },
  {
    title: 'Разделяйте задачи по сферам жизни',
    copy: 'Работа, дом, семья и личные планы живут рядом, но не смешиваются в один шум.',
  },
  {
    title: 'Не держите все в голове',
    copy: 'Chaotika помогает разгрузить память и вернуться к важному без лишней суеты.',
  },
] as const

const HERO_TAGS = ['Планы', 'Списки', 'Рутины'] as const

export function AuthGate({ children }: PropsWithChildren) {
  const {
    accessToken,
    authNotice,
    canUseProtectedApi,
    clearAuthNotice,
    email,
    expireSession,
    isAuthEnabled,
    isLoading,
    isPasswordRecovery,
    lifecycleStatus,
    recoverSession,
    requestPasswordReset,
    signOut,
    signInWithPassword,
    signUpWithPassword,
    updatePassword,
  } = useSessionAuth()
  const plannerSessionQuery = usePlannerSession()
  const handledUnauthorizedTokenRef = useRef<string | null>(null)
  const [mode, setMode] = useState<AuthMode>('login')
  const [formEmail, setFormEmail] = useState(email ?? '')
  const [displayName, setDisplayName] = useState('')
  const [password, setPassword] = useState('')
  const [passwordConfirmation, setPasswordConfirmation] = useState('')
  const [rememberMe, setRememberMe] = useState(() =>
    getRememberSessionPreference(),
  )
  const [fieldErrors, setFieldErrors] = useState<AuthFieldErrors>({})
  const [statusMessage, setStatusMessage] = useState<string | null>(null)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [hasLoginFailure, setHasLoginFailure] = useState(false)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const screenMode: AuthScreenMode = isPasswordRecovery ? 'recover' : mode
  const modeContent = AUTH_MODE_CONTENT[screenMode]
  const isNativeSessionRuntime = isNativeSessionPersistenceRuntime()
  const shouldShowRememberMe = !isNativeSessionRuntime
  const [isRecovering, setIsRecovering] = useState(false)
  const plannerSessionError = plannerSessionQuery.error
  const refetchPlannerSession = plannerSessionQuery.refetch
  const hasUnauthorizedPlannerSessionError =
    isUnauthorizedSessionApiError(plannerSessionError)
  const canResolvePlannerSession = canBootstrapPlannerSession({
    accessToken,
    config: plannerApiConfig,
    isAuthEnabled,
  })
  const authGateView = resolveAuthGateView({
    accessToken,
    canResolvePlannerSession,
    canUseProtectedApi,
    hasAuthNotice: Boolean(authNotice),
    hasPlannerSession: Boolean(plannerSessionQuery.data),
    hasPlannerSessionError: Boolean(plannerSessionError),
    hasUnauthorizedPlannerSessionError,
    isAuthEnabled,
    isLoading,
    isNativeSessionRuntime,
    isPasswordRecovery,
    isPlannerSessionPending: plannerSessionQuery.isPending,
    isRecovering,
    lifecycleStatus,
  })

  useEffect(() => {
    if (!isAuthEnabled || !accessToken || !hasUnauthorizedPlannerSessionError) {
      return
    }

    if (handledUnauthorizedTokenRef.current === accessToken) {
      return
    }

    handledUnauthorizedTokenRef.current = accessToken
    setIsRecovering(true)
    void recoverSession()
      .then((result) => {
        if (result === 'recovered') {
          handledUnauthorizedTokenRef.current = null
          void refetchPlannerSession()
        }
      })
      .catch((error) => {
        console.error('Failed to recover session.', error)
      })
      .finally(() => {
        setIsRecovering(false)
      })
  }, [
    accessToken,
    hasUnauthorizedPlannerSessionError,
    isAuthEnabled,
    recoverSession,
    refetchPlannerSession,
  ])

  useEffect(() => {
    if (!email) {
      return
    }

    setFormEmail((currentEmail) => currentEmail || email)
  }, [email])

  if (authGateView.type === 'children') {
    return children
  }

  if (authGateView.type === 'status_panel') {
    switch (authGateView.panel) {
      case 'disabled_auth_configuration':
        return (
          <AuthStatusPanel
            copy="В этой сборке не настроен вход в Chaotika, поэтому экран регистрации и входа недоступен."
            title="Сборка без настройки входа"
          >
            <p className={styles.errorBanner} role="alert">
              Для входа через Chaotika Auth нужна настройка
              VITE_AUTH_PROVIDER=planner. Служебный режим возможен только через
              VITE_API_ACCESS_TOKEN. VITE_ACTOR_USER_ID и VITE_WORKSPACE_ID
              доступны только для локальной разработки.
            </p>
          </AuthStatusPanel>
        )

      case 'restore_required':
        return (
          <AuthStatusPanel
            copy="Локальная сессия есть, но серверный вход не восстановился. Войдите снова, чтобы не работать с неполными данными."
            title="Нужно восстановить вход"
          >
            <div className={styles.actionRow}>
              <button
                className={styles.submitButton}
                type="button"
                onClick={() => {
                  void expireSession()
                }}
              >
                Войти заново
              </button>
            </div>
          </AuthStatusPanel>
        )

      case 'restoring_saved_sign_in':
        return (
          <AuthStatusPanel
            copy="Если вы уже входили на этом устройстве, Chaotika восстановит сессию автоматически."
            title="Проверяем сохраненный вход"
          />
        )

      case 'session_ended':
        return (
          <AuthStatusPanel
            copy="Текущая сессия больше не действует. Войдите снова, чтобы продолжить работу."
            title="Сессия завершилась"
          >
            <div className={styles.actionRow}>
              <button
                className={styles.submitButton}
                type="button"
                onClick={() => {
                  void expireSession()
                }}
              >
                Войти заново
              </button>
            </div>
          </AuthStatusPanel>
        )

      case 'unauthenticated_runtime_unavailable':
        return (
          <AuthStatusPanel
            copy="Этот стенд пока не готов к входу через браузер. Проверьте настройки и попробуйте снова."
            title="Вход временно недоступен"
          >
            <div className={styles.actionRow}>
              <button
                className={styles.submitButton}
                type="button"
                onClick={() => {
                  void plannerSessionQuery.refetch()
                }}
              >
                Проверить снова
              </button>
            </div>
          </AuthStatusPanel>
        )

      case 'planner_loading':
        return (
          <AuthStatusPanel
            copy="Проверяем доступ к вашему пространству, чтобы открыть планер."
            title="Открываем Chaotika"
          />
        )

      case 'planner_session_error':
        return (
          <AuthStatusPanel
            copy="Не удалось открыть ваш планер. Попробуйте еще раз или войдите повторно."
            title="Не получилось загрузить данные"
          >
            <p className={styles.errorBanner} role="alert">
              {getFriendlyPlannerSessionErrorMessage(plannerSessionQuery.error)}
            </p>
            <div className={styles.actionRow}>
              <button
                className={styles.submitButton}
                type="button"
                onClick={() => {
                  void plannerSessionQuery.refetch()
                }}
              >
                Повторить
              </button>
              {isAuthEnabled ? (
                <button
                  className={styles.secondaryButton}
                  type="button"
                  onClick={() => {
                    void signOut()
                  }}
                >
                  Выйти
                </button>
              ) : null}
            </div>
          </AuthStatusPanel>
        )
    }
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    clearAuthNotice()

    const normalizedEmail = formEmail.trim().toLowerCase()
    const validationErrors = validateAuthForm({
      email: normalizedEmail,
      password,
      passwordConfirmation,
      screenMode,
    })

    if (Object.keys(validationErrors).length > 0) {
      setFieldErrors(validationErrors)
      setErrorMessage(null)
      return
    }

    setIsSubmitting(true)
    setFieldErrors({})
    setErrorMessage(null)
    setStatusMessage(null)

    try {
      if (screenMode === 'recover') {
        await updatePassword(password)
        clearSensitiveFields()
        setHasLoginFailure(false)
        setStatusMessage('Пароль обновлен. Открываем ваш планер...')
        return
      }

      setRememberSessionPreference(shouldShowRememberMe ? rememberMe : true)

      if (screenMode === 'login') {
        await signInWithPassword(normalizedEmail, password)
        setHasLoginFailure(false)
        setStatusMessage('Вход выполнен. Открываем ваш планер...')
        return
      }

      const signUpResult = await signUpWithPassword({
        ...(displayName.trim() ? { displayName: displayName.trim() } : {}),
        email: normalizedEmail,
        password,
      })

      clearSensitiveFields()

      if (signUpResult.requiresEmailConfirmation) {
        setMode('login')
        setHasLoginFailure(false)
        setStatusMessage(
          `Аккаунт для ${normalizedEmail} создан. Подтвердите email по ссылке из письма и затем войдите.`,
        )
        return
      }

      setHasLoginFailure(false)
      setStatusMessage('Аккаунт создан. Открываем ваш планер...')
    } catch (error) {
      if (screenMode === 'login') {
        setHasLoginFailure(true)
      }

      setErrorMessage(getFriendlyAuthErrorMessage(error, screenMode))
    } finally {
      setIsSubmitting(false)
    }
  }

  async function handlePasswordResetRequest() {
    clearAuthNotice()

    const normalizedEmail = formEmail.trim().toLowerCase()
    const nextFieldErrors: AuthFieldErrors = {}

    if (!normalizedEmail) {
      nextFieldErrors.email = 'Введите email, чтобы восстановить пароль.'
    } else if (!isValidAuthEmail(normalizedEmail)) {
      nextFieldErrors.email = 'Введите email в корректном формате.'
    }

    if (Object.keys(nextFieldErrors).length > 0) {
      setFieldErrors((currentErrors) => ({
        ...currentErrors,
        ...nextFieldErrors,
      }))
      setErrorMessage(null)
      return
    }

    setIsSubmitting(true)
    setFieldErrors((currentErrors) =>
      omitAuthFieldError(currentErrors, 'email'),
    )
    setErrorMessage(null)
    setStatusMessage(null)

    try {
      await requestPasswordReset(normalizedEmail)
      clearSensitiveFields()
      setHasLoginFailure(false)
      setStatusMessage(
        `Письмо для восстановления отправлено на ${normalizedEmail}. Проверьте почту и задайте новый пароль.`,
      )
    } catch (error) {
      setErrorMessage(getFriendlyAuthErrorMessage(error, 'recover'))
    } finally {
      setIsSubmitting(false)
    }
  }

  function clearSensitiveFields() {
    setPassword('')
    setPasswordConfirmation('')
  }

  function handleModeChange(nextMode: AuthMode) {
    setMode(nextMode)
    clearAuthNotice()
    setFieldErrors({})
    setErrorMessage(null)
    setStatusMessage(null)
    setHasLoginFailure(false)
    clearSensitiveFields()

    if (nextMode !== 'register') {
      setDisplayName('')
    }
  }

  function handleFieldChange(field: AuthFieldName, value: string) {
    if (field === 'displayName') {
      setDisplayName(value)
    }

    if (field === 'email') {
      setFormEmail(value)
    }

    if (field === 'password') {
      setPassword(value)
    }

    if (field === 'passwordConfirmation') {
      setPasswordConfirmation(value)
    }

    setFieldErrors((currentErrors) => omitAuthFieldError(currentErrors, field))

    if (errorMessage) {
      setErrorMessage(null)
    }
  }

  return (
    <AuthShell>
      <div className={styles.formCardHeader}>
        {!isPasswordRecovery ? (
          <div
            className={styles.modeSwitch}
            role="tablist"
            aria-label="Режим авторизации"
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

        {screenMode === 'recover' ? (
          <p className={styles.formEyebrow}>Восстановление доступа</p>
        ) : null}
        <h2 className={styles.formTitle}>{modeContent.title}</h2>
        <p className={[styles.formCopy, styles.mobileHidden].join(' ')}>
          {modeContent.copy}
        </p>
      </div>

      <form
        className={styles.form}
        noValidate
        onSubmit={(event) => void handleSubmit(event)}
      >
        {screenMode === 'register' ? (
          <FormField
            autoComplete="name"
            error={fieldErrors.displayName}
            label="Имя"
            name="displayName"
            placeholder="Как вас называть"
            type="text"
            value={displayName}
            onChange={handleFieldChange}
          />
        ) : null}

        {screenMode !== 'recover' ? (
          <FormField
            autoComplete="email"
            error={fieldErrors.email}
            inputMode="email"
            label="Email"
            name="email"
            placeholder="name@example.com"
            type="email"
            value={formEmail}
            onChange={handleFieldChange}
          />
        ) : (
          <div className={styles.recoveryCard}>
            <span>Аккаунт для восстановления</span>
            <strong>{email ?? 'Email из письма восстановления'}</strong>
          </div>
        )}

        <FormField
          autoComplete={
            screenMode === 'register' || screenMode === 'recover'
              ? 'new-password'
              : 'current-password'
          }
          error={fieldErrors.password}
          label={screenMode === 'recover' ? 'Новый пароль' : 'Пароль'}
          name="password"
          placeholder={
            screenMode === 'register' || screenMode === 'recover'
              ? 'Минимум 6 символов'
              : 'Введите пароль'
          }
          type="password"
          value={password}
          onChange={handleFieldChange}
        />

        {screenMode === 'register' || screenMode === 'recover' ? (
          <FormField
            autoComplete="new-password"
            error={fieldErrors.passwordConfirmation}
            label={
              screenMode === 'recover'
                ? 'Повторите новый пароль'
                : 'Подтвердите пароль'
            }
            name="passwordConfirmation"
            placeholder={
              screenMode === 'recover'
                ? 'Повторите новый пароль'
                : 'Повторите пароль'
            }
            type="password"
            value={passwordConfirmation}
            onChange={handleFieldChange}
          />
        ) : null}

        {screenMode === 'login' && shouldShowRememberMe ? (
          <label className={styles.rememberRow}>
            <input
              checked={rememberMe}
              className={styles.rememberCheckbox}
              name="rememberMe"
              type="checkbox"
              onChange={(event) => setRememberMe(event.target.checked)}
            />
            <span>Запомнить меня</span>
          </label>
        ) : null}

        <p className={styles.helperText}>{modeContent.helper}</p>

        <div className={styles.feedbackStack}>
          {statusMessage ? (
            <p className={styles.messageBanner} aria-live="polite">
              {statusMessage}
            </p>
          ) : null}
          {authNotice ? (
            <p className={styles.errorBanner} role="alert">
              {authNotice}
            </p>
          ) : null}
          {errorMessage ? (
            <p className={styles.errorBanner} role="alert">
              {errorMessage}
            </p>
          ) : null}
        </div>

        <button
          className={styles.submitButton}
          disabled={isSubmitting}
          type="submit"
        >
          {isSubmitting ? (
            <span className={styles.buttonContent}>
              <span aria-hidden="true" className={styles.spinner} />
              {modeContent.pendingLabel}
            </span>
          ) : (
            modeContent.submitLabel
          )}
        </button>

        {screenMode === 'login' && hasLoginFailure ? (
          <button
            className={styles.inlineLink}
            disabled={isSubmitting}
            type="button"
            onClick={() => {
              void handlePasswordResetRequest()
            }}
          >
            Забыли пароль?
          </button>
        ) : null}

        {!isPasswordRecovery ? (
          <button
            className={styles.mobileModeLink}
            disabled={isSubmitting}
            type="button"
            onClick={() =>
              handleModeChange(mode === 'login' ? 'register' : 'login')
            }
          >
            {mode === 'login'
              ? 'Нет аккаунта? Зарегистрироваться'
              : 'Уже есть аккаунт? Войти'}
          </button>
        ) : null}
      </form>
    </AuthShell>
  )
}

function AuthShell({ children }: { children: ReactNode }) {
  return (
    <section className={styles.shell}>
      <div className={styles.panel}>
        <section className={styles.introCard}>
          <div className={styles.brandRow}>
            <div aria-hidden="true" className={styles.brandMark}>
              C
            </div>
            <div>
              <p className={styles.eyebrow}>Chaotika planner</p>
              <h1 className={styles.title}>Наведите порядок в хаосе дел.</h1>
            </div>
          </div>

          <p className={styles.copy}>
            Планер для жизни, где все происходит одновременно: работа, дом,
            дети, покупки, задачи и рутина.
          </p>

          <div className={styles.tagRow} aria-label="Возможности Chaotika">
            {HERO_TAGS.map((tag) => (
              <span key={tag} className={styles.tagChip}>
                {tag}
              </span>
            ))}
          </div>
        </section>

        <aside className={styles.formCard}>{children}</aside>

        <section className={styles.benefitsCard}>
          <ul className={styles.featureList}>
            {HERO_FEATURES.map((feature) => (
              <li key={feature.title} className={styles.featureItem}>
                <div className={styles.featureBullet} aria-hidden="true" />
                <div>
                  <strong>{feature.title}</strong>
                  <p>{feature.copy}</p>
                </div>
              </li>
            ))}
          </ul>

          <div className={styles.previewCard} aria-hidden="true">
            <div className={styles.previewHeader}>
              <span>Сегодня</span>
              <strong>Все под рукой</strong>
            </div>
            <div className={styles.previewList}>
              <div>
                <span>Работа</span>
                <strong>Подготовить встречу</strong>
              </div>
              <div>
                <span>Дом</span>
                <strong>Заказать продукты</strong>
              </div>
              <div>
                <span>Рутина</span>
                <strong>Не забыть важное</strong>
              </div>
            </div>
          </div>
        </section>
      </div>
    </section>
  )
}

function AuthStatusPanel({
  children,
  copy,
  title,
}: {
  children?: ReactNode
  copy: string
  title: string
}) {
  return (
    <AuthShell>
      <div className={styles.statusCard}>
        <p className={styles.formEyebrow}>Chaotika</p>
        <h2 className={styles.formTitle}>{title}</h2>
        <p className={styles.formCopy}>{copy}</p>
        <div className={styles.feedbackStack}>{children}</div>
      </div>
    </AuthShell>
  )
}

function FormField({
  autoComplete,
  error,
  inputMode,
  label,
  name,
  placeholder,
  type,
  value,
  onChange,
}: {
  autoComplete?: string | undefined
  error: string | undefined
  inputMode?:
    | 'email'
    | 'numeric'
    | 'search'
    | 'tel'
    | 'text'
    | 'url'
    | undefined
  label: string
  name: AuthFieldName
  placeholder: string
  type: string
  value: string
  onChange: (field: AuthFieldName, value: string) => void
}) {
  const errorId = `${name}-error`

  return (
    <label className={styles.field}>
      <span className={styles.fieldLabel}>{label}</span>
      <input
        aria-describedby={error ? errorId : undefined}
        aria-invalid={error ? 'true' : 'false'}
        autoComplete={autoComplete}
        inputMode={inputMode}
        name={name}
        placeholder={placeholder}
        type={type}
        value={value}
        onChange={(event) => onChange(name, event.target.value)}
      />
      {error ? (
        <span className={styles.fieldError} id={errorId} role="alert">
          {error}
        </span>
      ) : null}
    </label>
  )
}
