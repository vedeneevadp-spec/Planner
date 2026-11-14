import type { GoogleAuthSignInInput } from '@planner/contracts'
import { useCallback, useEffect, useRef, useState } from 'react'

import { isAndroidNativeRuntime } from '@/shared/lib/native-runtime'
import { useColorTheme } from '@/shared/lib/theme'

import { AuthApiError } from '../lib/auth-api'
import { getFriendlyAuthErrorMessage } from '../lib/auth-form'
import { setRememberSessionPreference } from '../lib/auth-session-storage'
import { getGoogleAuthClientId } from '../lib/google-auth-api'
import {
  isGoogleSignInSupported,
  loadGoogleIdentity,
  signInWithNativeGoogle,
} from '../lib/google-identity'
import { useSessionAuth } from '../lib/useSessionAuth'
import styles from './AuthGate.module.css'

export function GoogleSignIn({
  disabled,
  onBusyChange,
  rememberSession,
}: {
  disabled: boolean
  onBusyChange: (busy: boolean) => void
  rememberSession: boolean
}) {
  const { createGoogleChallenge, signInWithGoogle } = useSessionAuth()
  const { isDark } = useColorTheme()
  const buttonRef = useRef<HTMLDivElement>(null)
  const inFlightRef = useRef(false)
  const [clientId, setClientId] = useState<string | null>(null)
  const [ready, setReady] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [linkInput, setLinkInput] = useState<GoogleAuthSignInInput | null>(null)
  const [password, setPassword] = useState('')
  const [attempt, setAttempt] = useState(0)
  const native = isAndroidNativeRuntime()

  const finishSignIn = useCallback(
    async (input: GoogleAuthSignInInput) => {
      if (inFlightRef.current) return
      inFlightRef.current = true
      onBusyChange(true)
      setError(null)
      try {
        setRememberSessionPreference(rememberSession)
        await signInWithGoogle(input)
        setLinkInput(null)
        setPassword('')
      } catch (cause) {
        if (
          cause instanceof AuthApiError &&
          cause.code === 'auth_google_link_required'
        ) {
          setLinkInput({
            challengeToken: input.challengeToken,
            idToken: input.idToken,
          })
        } else if (
          cause instanceof AuthApiError &&
          cause.code === 'auth_invalid_credentials'
        ) {
          setError(
            'Пароль Хаотики не подошёл. Проверьте его или восстановите доступ по email.',
          )
        } else {
          setError(googleErrorMessage(cause))
          setLinkInput(null)
          setReady(false)
        }
      } finally {
        setPassword('')
        inFlightRef.current = false
        onBusyChange(false)
      }
    },
    [onBusyChange, rememberSession, signInWithGoogle],
  )

  useEffect(() => {
    if (!isGoogleSignInSupported()) return
    let active = true
    void getGoogleAuthClientId()
      .then((id) => {
        if (active) setClientId(id)
      })
      .catch(() => {
        /* Password sign-in stays available if configuration cannot load. */
      })
    return () => {
      active = false
    }
  }, [])

  useEffect(() => {
    if (!clientId) return
    let active = true
    let expiresTimer: number | undefined
    let resizeObserver: ResizeObserver | undefined
    async function prepare() {
      try {
        const challenge = await createGoogleChallenge()
        if (!active) return
        if (!native) {
          const api = await loadGoogleIdentity()
          if (!active || !buttonRef.current) return
          const button = buttonRef.current
          api.initialize({
            auto_select: false,
            client_id: challenge.clientId,
            nonce: challenge.nonce,
            ux_mode: 'popup',
            callback: ({ credential }) => {
              if (active)
                void finishSignIn({
                  challengeToken: challenge.challengeToken,
                  idToken: credential,
                })
            },
          })
          let renderedWidth = 0
          function renderGoogleButton() {
            const width = Math.min(400, button.clientWidth || 280)
            if (width === renderedWidth) return
            renderedWidth = width
            button.replaceChildren()
            api.renderButton(button, {
              locale: 'ru',
              shape: 'pill',
              size: 'large',
              text: 'continue_with',
              theme: isDark ? 'outline_dark' : 'outline',
              type: 'standard',
              width,
            })
          }
          renderGoogleButton()
          if (typeof ResizeObserver !== 'undefined') {
            resizeObserver = new ResizeObserver(renderGoogleButton)
            resizeObserver.observe(button)
          }
        }
        setReady(true)
        // Never submit an expired challenge from a login page left open.
        expiresTimer = window.setTimeout(
          () => {
            setReady(false)
            setLinkInput(null)
            setPassword('')
            setError(
              'Время ожидания истекло. Нажмите «Повторить вход через Google».',
            )
          },
          Math.max(0, Date.parse(challenge.expiresAt) - Date.now()),
        )
      } catch {
        if (active)
          setError(
            'Не удалось загрузить вход через Google. Проверьте соединение или войдите по email.',
          )
      }
    }
    void prepare()
    return () => {
      active = false
      window.clearTimeout(expiresTimer)
      resizeObserver?.disconnect()
    }
  }, [attempt, clientId, createGoogleChallenge, finishSignIn, isDark, native])

  async function startNativeSignIn() {
    if (disabled || inFlightRef.current) return
    inFlightRef.current = true
    onBusyChange(true)
    setError(null)
    try {
      const challenge = await createGoogleChallenge()
      const { idToken } = await signInWithNativeGoogle(
        challenge.clientId,
        challenge.nonce,
      )
      inFlightRef.current = false
      await finishSignIn({ challengeToken: challenge.challengeToken, idToken })
    } catch (cause) {
      if (!isGoogleCancellation(cause))
        setError(
          'Google не смог выполнить вход. Попробуйте ещё раз или войдите по email.',
        )
    } finally {
      inFlightRef.current = false
      onBusyChange(false)
    }
  }

  if (!clientId) return null
  return (
    <div className={styles.googleSection}>
      <div
        className={styles.googleButtonHost}
        ref={buttonRef}
        hidden={native || Boolean(linkInput)}
        style={{ visibility: ready ? 'visible' : 'hidden' }}
        inert={disabled}
      />
      {native && !linkInput && (
        <button
          className={styles.googleButton}
          disabled={disabled || !ready}
          type="button"
          onClick={() => void startNativeSignIn()}
        >
          <GoogleMark />
          Продолжить с Google
        </button>
      )}
      {!ready && !error && (
        <p className={styles.formCopy} role="status">
          Подключаем Google…
        </p>
      )}
      {linkInput && (
        <form
          className={styles.googleLinkForm}
          onSubmit={(event) => {
            event.preventDefault()
            if (password && !disabled)
              void finishSignIn({ ...linkInput, currentPassword: password })
          }}
        >
          <p className={styles.formCopy}>
            Аккаунт с этой почтой уже есть. Введите пароль Хаотики один раз,
            чтобы подключить Google и сохранить свои данные.
          </p>
          <label className={styles.field}>
            <span>Пароль Хаотики</span>
            <input
              autoComplete="current-password"
              type="password"
              required
              maxLength={128}
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              disabled={disabled}
            />
          </label>
          <button
            className={styles.submitButton}
            disabled={disabled || !password}
            type="submit"
          >
            Подключить Google и войти
          </button>
          <button
            className={styles.secondaryButton}
            disabled={disabled}
            type="button"
            onClick={() => {
              setLinkInput(null)
              setPassword('')
              setError(null)
              setReady(false)
              setAttempt((value) => value + 1)
            }}
          >
            Отмена
          </button>
        </form>
      )}
      {error && (
        <p className={styles.errorBanner} role="alert">
          {error}
        </p>
      )}
      {!ready && error && (
        <button
          className={styles.secondaryButton}
          disabled={disabled}
          type="button"
          onClick={() => {
            setError(null)
            setAttempt((value) => value + 1)
          }}
        >
          Повторить вход через Google
        </button>
      )}
      <div className={styles.authDivider}>или по email</div>
    </div>
  )
}

function googleErrorMessage(error: unknown): string {
  if (error instanceof AuthApiError) {
    if (error.code === 'auth_google_account_conflict')
      return 'Этот Google-аккаунт нельзя подключить. Войдите в Хаотику по email или выберите другой аккаунт Google.'
    if (
      error.code === 'auth_google_challenge_invalid' ||
      error.code === 'auth_google_token_invalid'
    )
      return 'Не удалось подтвердить вход. Повторите вход через Google.'
    if (error.code === 'auth_google_disabled')
      return 'Вход через Google временно недоступен. Войдите по email.'
  }
  return getFriendlyAuthErrorMessage(error, 'login')
}

function isGoogleCancellation(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    error.code === 'GOOGLE_SIGN_IN_CANCELLED'
  )
}

function GoogleMark() {
  return (
    <svg aria-hidden="true" width="20" height="20" viewBox="0 0 48 48">
      <path
        fill="#EA4335"
        d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"
      />
      <path
        fill="#4285F4"
        d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"
      />
      <path
        fill="#FBBC05"
        d="M10.53 28.59A14.41 14.41 0 019.75 24c0-1.59.27-3.13.78-4.59l-7.98-6.19A23.87 23.87 0 000 24c0 3.87.93 7.53 2.56 10.78l7.97-6.19z"
      />
      <path
        fill="#34A853"
        d="M24 48c6.48 0 11.93-2.13 15.91-5.8l-7.73-6c-2.15 1.45-4.92 2.3-8.18 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"
      />
    </svg>
  )
}
