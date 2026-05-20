import { describe, expect, it } from 'vitest'

import {
  getFriendlyAuthErrorMessage,
  getFriendlyPlannerSessionErrorMessage,
  isValidAuthEmail,
  omitAuthFieldError,
  validateAuthForm,
} from './auth-form'
import { SessionApiError } from './session-api'

describe('auth form helpers', () => {
  it('validates login credentials', () => {
    expect(
      validateAuthForm({
        email: '',
        password: '',
        passwordConfirmation: '',
        screenMode: 'login',
      }),
    ).toEqual({
      email: 'Введите email.',
      password: 'Введите пароль.',
    })

    expect(
      validateAuthForm({
        email: 'not-an-email',
        password: 'secret',
        passwordConfirmation: '',
        screenMode: 'login',
      }),
    ).toEqual({
      email: 'Введите email в корректном формате.',
    })
  })

  it('validates register and recovery password confirmation', () => {
    expect(
      validateAuthForm({
        email: 'new@example.com',
        password: 'short',
        passwordConfirmation: '',
        screenMode: 'register',
      }),
    ).toEqual({
      password: 'Пароль должен содержать минимум 6 символов.',
      passwordConfirmation: 'Подтвердите пароль.',
    })

    expect(
      validateAuthForm({
        email: '',
        password: 'new-secret',
        passwordConfirmation: 'different',
        screenMode: 'recover',
      }),
    ).toEqual({
      passwordConfirmation: 'Пароли не совпадают.',
    })
  })

  it('checks auth email syntax and removes one field error', () => {
    expect(isValidAuthEmail('user@example.com')).toBe(true)
    expect(isValidAuthEmail('user@example')).toBe(false)

    expect(
      omitAuthFieldError(
        {
          email: 'Введите email.',
          password: 'Введите пароль.',
        },
        'email',
      ),
    ).toEqual({
      password: 'Введите пароль.',
    })
  })

  it('maps auth errors to user-facing messages', () => {
    expect(
      getFriendlyAuthErrorMessage(
        Object.assign(new Error('Invalid login credentials'), {
          code: 'auth_invalid_credentials',
        }),
        'login',
      ),
    ).toBe('Неверный email или пароль.')

    expect(
      getFriendlyAuthErrorMessage(
        Object.assign(new Error('Already registered'), {
          code: 'auth_email_taken',
        }),
        'register',
      ),
    ).toBe('Такой email уже зарегистрирован.')

    expect(
      getFriendlyAuthErrorMessage(new Error('rate limit exceeded'), 'recover'),
    ).toBe('Слишком много попыток. Попробуйте чуть позже.')

    expect(getFriendlyAuthErrorMessage(new Error('unknown'), 'register')).toBe(
      'Не удалось создать аккаунт. Попробуйте еще раз.',
    )
  })

  it('maps planner session errors to user-facing messages', () => {
    expect(
      getFriendlyPlannerSessionErrorMessage(
        new SessionApiError('Forbidden', {
          code: 'workspace_forbidden',
          status: 403,
        }),
      ),
    ).toBe('Для этого пространства пока нет доступа.')

    expect(
      getFriendlyPlannerSessionErrorMessage(
        new SessionApiError('Server unavailable', {
          code: 'session_request_failed',
          status: 503,
        }),
      ),
    ).toBe(
      'Не удалось связаться с сервером. Проверьте соединение и попробуйте еще раз.',
    )

    expect(
      getFriendlyPlannerSessionErrorMessage(new Error('Raw failure')),
    ).toBe('Raw failure')

    expect(getFriendlyPlannerSessionErrorMessage(null)).toBe(
      'Не удалось открыть рабочее пространство.',
    )
  })
})
