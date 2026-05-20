import { SessionApiError } from './session-api'

export type AuthMode = 'login' | 'register'
export type AuthScreenMode = AuthMode | 'recover'
export type AuthFieldName =
  | 'displayName'
  | 'email'
  | 'password'
  | 'passwordConfirmation'
export type AuthFieldErrors = Partial<Record<AuthFieldName, string>>

const MIN_PASSWORD_LENGTH = 6

export function validateAuthForm({
  email,
  password,
  passwordConfirmation,
  screenMode,
}: {
  email: string
  password: string
  passwordConfirmation: string
  screenMode: AuthScreenMode
}): AuthFieldErrors {
  const errors: AuthFieldErrors = {}

  if (screenMode !== 'recover') {
    if (!email) {
      errors.email = 'Введите email.'
    } else if (!isValidAuthEmail(email)) {
      errors.email = 'Введите email в корректном формате.'
    }
  }

  if (!password) {
    errors.password =
      screenMode === 'recover' ? 'Введите новый пароль.' : 'Введите пароль.'
  } else if (
    (screenMode === 'register' || screenMode === 'recover') &&
    password.length < MIN_PASSWORD_LENGTH
  ) {
    errors.password = `Пароль должен содержать минимум ${MIN_PASSWORD_LENGTH} символов.`
  }

  if (screenMode === 'register' || screenMode === 'recover') {
    if (!passwordConfirmation) {
      errors.passwordConfirmation =
        screenMode === 'recover'
          ? 'Повторите новый пароль.'
          : 'Подтвердите пароль.'
    } else if (password !== passwordConfirmation) {
      errors.passwordConfirmation = 'Пароли не совпадают.'
    }
  }

  return errors
}

export function omitAuthFieldError(
  errors: AuthFieldErrors,
  field: AuthFieldName,
): AuthFieldErrors {
  const nextErrors = { ...errors }
  delete nextErrors[field]
  return nextErrors
}

export function getFriendlyAuthErrorMessage(
  error: unknown,
  screenMode: AuthScreenMode,
): string {
  if (error instanceof SessionApiError) {
    return getFriendlyPlannerSessionErrorMessage(error)
  }

  if (hasAuthErrorCode(error, 'auth_invalid_credentials')) {
    return 'Неверный email или пароль.'
  }

  if (hasAuthErrorCode(error, 'auth_email_taken')) {
    return 'Такой email уже зарегистрирован.'
  }

  if (hasAuthErrorCode(error, 'auth_password_reset_token_invalid')) {
    return 'Ссылка восстановления устарела. Запросите письмо еще раз.'
  }

  const message = error instanceof Error ? error.message.toLowerCase() : ''

  if (message.includes('invalid login credentials')) {
    return 'Неверный email или пароль.'
  }

  if (message.includes('email not confirmed')) {
    return 'Подтвердите email по ссылке из письма и попробуйте снова.'
  }

  if (message.includes('user already registered')) {
    return 'Такой email уже зарегистрирован.'
  }

  if (message.includes('password should be at least')) {
    return `Пароль должен содержать минимум ${MIN_PASSWORD_LENGTH} символов.`
  }

  if (message.includes('unable to validate email address')) {
    return 'Введите email в корректном формате.'
  }

  if (
    message.includes('rate limit') ||
    message.includes('too many requests') ||
    message.includes('over_email_send_rate_limit')
  ) {
    return 'Слишком много попыток. Попробуйте чуть позже.'
  }

  if (message.includes('signup is disabled')) {
    return 'Регистрация временно недоступна.'
  }

  if (message.includes('network') || message.includes('fetch')) {
    return 'Не удалось связаться с сервером. Попробуйте еще раз.'
  }

  if (screenMode === 'register') {
    return 'Не удалось создать аккаунт. Попробуйте еще раз.'
  }

  if (screenMode === 'recover') {
    return 'Не удалось завершить действие. Попробуйте еще раз.'
  }

  return 'Не удалось войти. Попробуйте еще раз.'
}

export function getFriendlyPlannerSessionErrorMessage(error: unknown): string {
  if (error instanceof SessionApiError) {
    if (error.status >= 500) {
      return 'Не удалось связаться с сервером. Проверьте соединение и попробуйте еще раз.'
    }

    if (error.status === 403) {
      return 'Для этого пространства пока нет доступа.'
    }

    if (error.status === 404) {
      return 'Рабочее пространство не найдено.'
    }
  }

  if (error instanceof Error && error.message.trim()) {
    return error.message
  }

  return 'Не удалось открыть рабочее пространство.'
}

export function isValidAuthEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)
}

function hasAuthErrorCode(error: unknown, code: string): boolean {
  return error instanceof Error && 'code' in error && error.code === code
}
