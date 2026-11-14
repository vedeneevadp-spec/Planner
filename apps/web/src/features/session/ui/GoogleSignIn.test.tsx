import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react'
import { useState } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { AuthApiError } from '../lib/auth-api'
import { GoogleSignIn } from './GoogleSignIn'

const mocks = vi.hoisted(() => ({
  clientId: vi.fn(),
  createChallenge: vi.fn(),
  signIn: vi.fn(),
  native: vi.fn(),
  supported: vi.fn(),
  load: vi.fn(),
  nativeSignIn: vi.fn(),
  initialize:
    vi.fn<
      (options: {
        callback: (response: { credential: string }) => void
      }) => void
    >(),
  renderButton: vi.fn(),
}))
vi.mock('@/shared/lib/theme', () => ({
  useColorTheme: () => ({ isDark: true }),
}))

vi.mock('../lib/google-auth-api', () => ({
  getGoogleAuthClientId: mocks.clientId,
}))
vi.mock('../lib/useSessionAuth', () => ({
  useSessionAuth: () => ({
    createGoogleChallenge: mocks.createChallenge,
    signInWithGoogle: mocks.signIn,
  }),
}))
vi.mock('@/shared/lib/native-runtime', () => ({
  isAndroidNativeRuntime: mocks.native,
}))
vi.mock('../lib/google-identity', () => ({
  isGoogleSignInSupported: mocks.supported,
  loadGoogleIdentity: mocks.load,
  signInWithNativeGoogle: mocks.nativeSignIn,
}))

function Harness() {
  const [busy, setBusy] = useState(false)
  return (
    <GoogleSignIn
      disabled={busy}
      onBusyChange={setBusy}
      rememberSession={true}
    />
  )
}

const challenge = () => ({
  clientId: '123-web.apps.googleusercontent.com',
  challengeToken: 'challenge',
  nonce: 'nonce',
  expiresAt: new Date(Date.now() + 600_000).toISOString(),
})

describe('GoogleSignIn', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.clientId.mockResolvedValue('123-web.apps.googleusercontent.com')
    mocks.createChallenge.mockImplementation(() => Promise.resolve(challenge()))
    mocks.signIn.mockResolvedValue(undefined)
    mocks.native.mockReturnValue(false)
    mocks.supported.mockReturnValue(true)
    mocks.load.mockResolvedValue({
      initialize: mocks.initialize,
      renderButton: mocks.renderButton,
    })
    mocks.renderButton.mockImplementation((element: HTMLElement) => {
      const button = document.createElement('button')
      button.textContent = 'Продолжить с Google'
      button.onclick = () =>
        mocks.initialize.mock.lastCall?.[0].callback({
          credential: 'google-id-token',
        })
      element.append(button)
    })
    mocks.nativeSignIn.mockResolvedValue({ idToken: 'native-id-token' })
  })
  afterEach(cleanup)

  it('hides Google when disabled and does not load its SDK', async () => {
    mocks.clientId.mockResolvedValue(null)
    render(<Harness />)
    await waitFor(() => expect(mocks.clientId).toHaveBeenCalledOnce())
    expect(screen.queryByRole('button')).toBeNull()
    expect(mocks.load).not.toHaveBeenCalled()
  })

  it('submits the browser credential with its nonce challenge', async () => {
    render(<Harness />)
    fireEvent.click(
      await screen.findByRole('button', { name: 'Продолжить с Google' }),
    )
    await waitFor(() =>
      expect(mocks.signIn).toHaveBeenCalledWith({
        challengeToken: 'challenge',
        idToken: 'google-id-token',
      }),
    )
    expect(mocks.initialize).toHaveBeenCalledWith(
      expect.objectContaining({ nonce: 'nonce', auto_select: false }),
    )
  })

  it('asks for the existing password and retains the credential after an incorrect password', async () => {
    mocks.signIn
      .mockRejectedValueOnce(
        new AuthApiError('Link', {
          code: 'auth_google_link_required',
          status: 409,
        }),
      )
      .mockRejectedValueOnce(
        new AuthApiError('Wrong', {
          code: 'auth_invalid_credentials',
          status: 401,
        }),
      )
      .mockResolvedValueOnce(undefined)
    render(<Harness />)
    fireEvent.click(
      await screen.findByRole('button', { name: 'Продолжить с Google' }),
    )
    const password = await screen.findByLabelText('Пароль Хаотики')
    fireEvent.change(password, { target: { value: 'wrong-password' } })
    fireEvent.click(
      screen.getByRole('button', { name: 'Подключить Google и войти' }),
    )
    await screen.findByText(/Пароль Хаотики не подошёл/)
    expect(password).toHaveValue('')
    fireEvent.change(password, { target: { value: 'correct-password' } })
    fireEvent.click(
      screen.getByRole('button', { name: 'Подключить Google и войти' }),
    )
    await waitFor(() =>
      expect(mocks.signIn).toHaveBeenLastCalledWith({
        challengeToken: 'challenge',
        idToken: 'google-id-token',
        currentPassword: 'correct-password',
      }),
    )
  })

  it('uses native Credential Manager on Android without loading the browser SDK', async () => {
    mocks.native.mockReturnValue(true)
    render(<Harness />)
    const button = await screen.findByRole('button', {
      name: 'Продолжить с Google',
    })
    await waitFor(() => expect(button).toBeEnabled())
    fireEvent.click(button)
    await waitFor(() =>
      expect(mocks.signIn).toHaveBeenCalledWith({
        challengeToken: 'challenge',
        idToken: 'native-id-token',
      }),
    )
    expect(mocks.nativeSignIn).toHaveBeenCalledWith(
      '123-web.apps.googleusercontent.com',
      'nonce',
    )
    expect(mocks.load).not.toHaveBeenCalled()
  })

  it('treats native cancellation as a normal return to sign-in', async () => {
    mocks.native.mockReturnValue(true)
    mocks.nativeSignIn.mockRejectedValue({ code: 'GOOGLE_SIGN_IN_CANCELLED' })
    render(<Harness />)
    const button = await screen.findByRole('button', {
      name: 'Продолжить с Google',
    })
    await waitFor(() => expect(button).toBeEnabled())
    fireEvent.click(button)
    await waitFor(() => expect(mocks.nativeSignIn).toHaveBeenCalledOnce())
    await waitFor(() => expect(button).toBeEnabled())
    expect(mocks.signIn).not.toHaveBeenCalled()
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('offers a retry when the Google SDK cannot load', async () => {
    mocks.load.mockRejectedValueOnce(new Error('Network')).mockResolvedValue({
      initialize: mocks.initialize,
      renderButton: mocks.renderButton,
    })
    render(<Harness />)
    fireEvent.click(
      await screen.findByRole('button', {
        name: 'Повторить вход через Google',
      }),
    )
    expect(
      await screen.findByRole('button', { name: 'Продолжить с Google' }),
    ).toBeInTheDocument()
  })
})
