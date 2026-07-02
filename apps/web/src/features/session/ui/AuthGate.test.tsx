import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { SessionApiError } from '../lib/session-api'
import { AuthGate } from './AuthGate'

interface SessionAuthStub {
  accessToken: string | null
  authNotice: string | null
  canUseProtectedApi: boolean
  clearAuthNotice: () => void
  email: string | null
  expireSession: () => Promise<void>
  isAuthEnabled: boolean
  isLoading: boolean
  isPasswordRecovery: boolean
  lifecycleStatus:
    'authenticated' | 'deferred' | 'disabled' | 'restoring' | 'signed_out'
  recoverSession: () => Promise<'deferred' | 'recovered' | 'signed_out'>
  requestPasswordReset: (email: string) => Promise<void>
  signOut: () => Promise<void>
  signInWithPassword: (email: string, password: string) => Promise<void>
  signUpWithPassword: (input: {
    displayName?: string
    email: string
    password: string
  }) => Promise<{ requiresEmailConfirmation: boolean }>
  updatePassword: (password: string) => Promise<void>
}

interface PlannerSessionQueryStub {
  data: unknown
  error: unknown
  isPending: boolean
  refetch: () => Promise<void>
}

const mocks = vi.hoisted(() => ({
  getRememberSessionPreference: vi.fn<() => boolean>(),
  isNativeSessionPersistenceRuntime: vi.fn<() => boolean>(),
  setRememberSessionPreference: vi.fn<(value: boolean) => void>(),
  usePlannerSession: vi.fn<() => PlannerSessionQueryStub>(),
  useSessionAuth: vi.fn<() => SessionAuthStub>(),
}))

vi.mock('@/shared/config/planner-api', () => ({
  plannerApiConfig: {
    apiBaseUrl: 'https://api.chaotika.test',
    authProvider: 'planner',
  },
}))

vi.mock('../lib/auth-session-storage', () => ({
  getRememberSessionPreference: mocks.getRememberSessionPreference,
  setRememberSessionPreference: mocks.setRememberSessionPreference,
}))

vi.mock('../lib/native-session-storage', () => ({
  isNativeSessionPersistenceRuntime: mocks.isNativeSessionPersistenceRuntime,
}))

vi.mock('../lib/usePlannerSession', () => ({
  usePlannerSession: () => mocks.usePlannerSession(),
}))

vi.mock('../lib/useSessionAuth', () => ({
  useSessionAuth: () => mocks.useSessionAuth(),
}))

describe('AuthGate', () => {
  let auth: SessionAuthStub
  let plannerSessionQuery: PlannerSessionQueryStub

  beforeEach(() => {
    auth = {
      accessToken: null,
      authNotice: null,
      canUseProtectedApi: false,
      clearAuthNotice: vi.fn(),
      email: null,
      expireSession: vi.fn(() => Promise.resolve()),
      isAuthEnabled: true,
      isLoading: false,
      isPasswordRecovery: false,
      lifecycleStatus: 'signed_out',
      recoverSession: vi.fn<
        () => Promise<'deferred' | 'recovered' | 'signed_out'>
      >(() => Promise.resolve('signed_out')),
      requestPasswordReset: vi.fn(() => Promise.resolve()),
      signOut: vi.fn(() => Promise.resolve()),
      signInWithPassword: vi.fn(() => Promise.resolve()),
      signUpWithPassword: vi.fn(() =>
        Promise.resolve({ requiresEmailConfirmation: false }),
      ),
      updatePassword: vi.fn(() => Promise.resolve()),
    }
    plannerSessionQuery = {
      data: null,
      error: null,
      isPending: false,
      refetch: vi.fn(() => Promise.resolve()),
    }

    mocks.getRememberSessionPreference.mockReturnValue(true)
    mocks.isNativeSessionPersistenceRuntime.mockReturnValue(false)
    mocks.setRememberSessionPreference.mockReset()
    mocks.usePlannerSession.mockImplementation(() => plannerSessionQuery)
    mocks.useSessionAuth.mockImplementation(() => auth)
  })

  afterEach(() => {
    cleanup()
  })

  it('renders the application when the planner session is ready', () => {
    plannerSessionQuery.data = {
      actorUserId: 'user-1',
      workspaceId: 'workspace-1',
    }
    auth.accessToken = 'access-token'
    auth.canUseProtectedApi = true
    auth.lifecycleStatus = 'authenticated'

    render(
      <AuthGate>
        <main>Planner content</main>
      </AuthGate>,
    )

    expect(screen.getByText('Planner content')).toBeVisible()
  })

  it('does not render cached planner content while auth storage is restoring', () => {
    auth.isLoading = true
    auth.lifecycleStatus = 'restoring'
    plannerSessionQuery.data = {
      actorUserId: 'user-1',
      workspaceId: 'workspace-1',
    }

    render(
      <AuthGate>
        <main>Planner content</main>
      </AuthGate>,
    )

    expect(screen.getByText('Проверяем сохраненный вход')).toBeVisible()
    expect(screen.queryByText('Planner content')).not.toBeInTheDocument()
  })

  it('keeps cached planner content visible while native auth storage is restoring', () => {
    auth.isLoading = true
    auth.lifecycleStatus = 'restoring'
    mocks.isNativeSessionPersistenceRuntime.mockReturnValue(true)
    plannerSessionQuery.data = {
      actorUserId: 'user-1',
      workspaceId: 'workspace-1',
    }

    render(
      <AuthGate>
        <main>Planner content</main>
      </AuthGate>,
    )

    expect(screen.getByText('Planner content')).toBeVisible()
    expect(
      screen.queryByText('Проверяем сохраненный вход'),
    ).not.toBeInTheDocument()
  })

  it('does not treat a cached planner session as signed in without an access token', () => {
    auth.isLoading = false
    auth.accessToken = null
    auth.canUseProtectedApi = false
    auth.lifecycleStatus = 'signed_out'
    plannerSessionQuery.data = {
      actorUserId: 'user-1',
      workspaceId: 'workspace-1',
    }

    render(
      <AuthGate>
        <main>Planner content</main>
      </AuthGate>,
    )

    expect(screen.getByText('Нужно восстановить вход')).toBeVisible()
    expect(screen.queryByText('Planner content')).not.toBeInTheDocument()
  })

  it('keeps cached planner content visible for a deferred native device session', () => {
    auth.isLoading = false
    auth.accessToken = null
    auth.canUseProtectedApi = false
    auth.lifecycleStatus = 'deferred'
    mocks.isNativeSessionPersistenceRuntime.mockReturnValue(true)
    plannerSessionQuery.data = {
      actorUserId: 'user-1',
      workspaceId: 'workspace-1',
    }

    render(
      <AuthGate>
        <main>Planner content</main>
      </AuthGate>,
    )

    expect(screen.getByText('Planner content')).toBeVisible()
    expect(
      screen.queryByText('Нужно восстановить вход'),
    ).not.toBeInTheDocument()
  })

  it('shows a disabled-auth configuration error when no session can be bootstrapped', () => {
    auth.isAuthEnabled = false

    render(
      <AuthGate>
        <main>Planner content</main>
      </AuthGate>,
    )

    expect(screen.getByText('Сборка без настройки входа')).toBeVisible()
    expect(screen.queryByText('Planner content')).not.toBeInTheDocument()
  })

  it('shows loading and planner error states before rendering children', async () => {
    auth.accessToken = 'access-token'
    auth.canUseProtectedApi = true
    auth.lifecycleStatus = 'authenticated'
    plannerSessionQuery.isPending = true

    const { rerender } = render(
      <AuthGate>
        <main>Planner content</main>
      </AuthGate>,
    )

    expect(screen.getByText('Открываем Chaotika')).toBeVisible()

    plannerSessionQuery.isPending = false
    plannerSessionQuery.error = new SessionApiError('Server unavailable', {
      code: 'session_request_failed',
      status: 503,
    })

    rerender(
      <AuthGate>
        <main>Planner content</main>
      </AuthGate>,
    )

    expect(screen.getByText('Не получилось загрузить данные')).toBeVisible()

    fireEvent.click(screen.getByRole('button', { name: 'Повторить' }))
    await waitFor(() => {
      expect(plannerSessionQuery.refetch).toHaveBeenCalled()
    })

    fireEvent.click(screen.getByRole('button', { name: 'Выйти' }))
    await waitFor(() => {
      expect(auth.signOut).toHaveBeenCalled()
    })
  })

  it('validates login fields and offers password reset after failed login', async () => {
    const loginError = Object.assign(new Error('Invalid login credentials'), {
      code: 'auth_invalid_credentials',
    })
    auth.signInWithPassword = vi.fn(() => Promise.reject(loginError))

    render(
      <AuthGate>
        <main>Planner content</main>
      </AuthGate>,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Войти' }))

    expect(await screen.findByText('Введите email.')).toBeVisible()
    expect(screen.getByText('Введите пароль.')).toBeVisible()

    fireEvent.change(screen.getByPlaceholderText('name@example.com'), {
      target: { value: 'USER@Example.COM ' },
    })
    fireEvent.change(screen.getByPlaceholderText('Введите пароль'), {
      target: { value: 'secret123' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Войти' }))

    await waitFor(() => {
      expect(auth.signInWithPassword).toHaveBeenCalledWith(
        'user@example.com',
        'secret123',
      )
    })
    expect(await screen.findByText('Неверный email или пароль.')).toBeVisible()

    fireEvent.click(screen.getByRole('button', { name: 'Забыли пароль?' }))

    await waitFor(() => {
      expect(auth.requestPasswordReset).toHaveBeenCalledWith('user@example.com')
    })
    expect(
      await screen.findByText(
        'Письмо для восстановления отправлено на user@example.com. Проверьте почту и задайте новый пароль.',
      ),
    ).toBeVisible()
  })

  it('creates an account and switches back to login when email confirmation is required', async () => {
    auth.signUpWithPassword = vi.fn(() =>
      Promise.resolve({ requiresEmailConfirmation: true }),
    )

    render(
      <AuthGate>
        <main>Planner content</main>
      </AuthGate>,
    )

    fireEvent.click(screen.getByRole('tab', { name: 'Регистрация' }))
    fireEvent.change(screen.getByLabelText('Имя'), {
      target: { value: 'Darya' },
    })
    fireEvent.change(screen.getByLabelText('Email'), {
      target: { value: 'new@example.com' },
    })
    fireEvent.change(screen.getByLabelText('Пароль'), {
      target: { value: 'secret123' },
    })
    fireEvent.change(screen.getByLabelText('Подтвердите пароль'), {
      target: { value: 'secret123' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Создать аккаунт' }))

    await waitFor(() => {
      expect(auth.signUpWithPassword).toHaveBeenCalledWith({
        displayName: 'Darya',
        email: 'new@example.com',
        password: 'secret123',
      })
    })
    expect(
      await screen.findByText(
        'Аккаунт для new@example.com создан. Подтвердите email по ссылке из письма и затем войдите.',
      ),
    ).toBeVisible()
    expect(screen.getByRole('tab', { name: 'Вход' })).toHaveAttribute(
      'aria-selected',
      'true',
    )
  })

  it('updates a password in recovery mode', async () => {
    auth.email = 'recover@example.com'
    auth.isPasswordRecovery = true

    render(
      <AuthGate>
        <main>Planner content</main>
      </AuthGate>,
    )

    expect(screen.getByText('recover@example.com')).toBeVisible()

    fireEvent.change(screen.getByLabelText('Новый пароль'), {
      target: { value: 'new-secret' },
    })
    fireEvent.change(screen.getByLabelText('Повторите новый пароль'), {
      target: { value: 'new-secret' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Сохранить пароль' }))

    await waitFor(() => {
      expect(auth.updatePassword).toHaveBeenCalledWith('new-secret')
    })
    expect(
      await screen.findByText('Пароль обновлен. Открываем ваш планер...'),
    ).toBeVisible()
  })
})
