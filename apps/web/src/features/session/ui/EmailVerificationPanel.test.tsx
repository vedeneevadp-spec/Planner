import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'

import { EmailVerificationPanel } from './EmailVerificationPanel'

vi.mock('../lib/usePlannerSession', () => ({
  usePlannerSession: () => ({ data: { actorUserId: 'alice' } }),
}))
vi.mock('../lib/useSessionAuth', () => ({
  useSessionAuth: () => ({ accessToken: 'token' }),
}))

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

it('sends a code, confirms it, and refreshes previously hidden invitations', async () => {
  const calls: Array<{ url: string; body: unknown }> = []
  vi.stubGlobal(
    'fetch',
    vi.fn((url: string, init: RequestInit) => {
      calls.push({
        url,
        body: typeof init.body === 'string' ? JSON.parse(init.body) : null,
      })
      if (url.endsWith('/request'))
        return Promise.resolve(new Response(null, { status: 204 }))
      return Promise.resolve(
        new Response(
          JSON.stringify({
            email: 'alice@example.test',
            verified: url.endsWith('/confirm'),
          }),
          { status: 200 },
        ),
      )
    }),
  )
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  const invalidate = vi.spyOn(client, 'invalidateQueries')
  render(
    <QueryClientProvider client={client}>
      <EmailVerificationPanel />
    </QueryClientProvider>,
  )
  await waitFor(() =>
    expect(
      screen.getByRole('button', { name: 'Отправить код на почту' }),
    ).toBeEnabled(),
  )
  fireEvent.click(
    screen.getByRole('button', { name: 'Отправить код на почту' }),
  )
  expect(await screen.findByRole('status')).toHaveTextContent(
    'alice@example.test',
  )
  fireEvent.change(screen.getByLabelText('Код из письма'), {
    target: { value: 'ABCD-1234-EF56' },
  })
  fireEvent.click(screen.getByRole('button', { name: 'Подтвердить email' }))
  expect(
    await screen.findByRole('heading', { name: 'Email подтверждён' }),
  ).toBeVisible()
  expect(calls.find((call) => call.url.endsWith('/confirm'))?.body).toEqual({
    code: 'ABCD-1234-EF56',
  })
  expect(invalidate).toHaveBeenCalledWith({
    queryKey: ['workspace-invitations', 'received'],
  })
})

it('shows an invalid code without claiming the mailbox is verified', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn((url: string) =>
      Promise.resolve(
        new Response(
          JSON.stringify(
            url.endsWith('/confirm')
              ? {
                  error: {
                    code: 'email_verification_code_invalid',
                    message: 'Код неверен или истёк.',
                  },
                }
              : { email: 'alice@example.test', verified: false },
          ),
          { status: url.endsWith('/confirm') ? 400 : 200 },
        ),
      ),
    ),
  )
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  render(
    <QueryClientProvider client={client}>
      <EmailVerificationPanel />
    </QueryClientProvider>,
  )
  fireEvent.change(screen.getByLabelText('Код из письма'), {
    target: { value: '000000000000' },
  })
  fireEvent.click(screen.getByRole('button', { name: 'Подтвердить email' }))
  expect(await screen.findByRole('alert')).toBeVisible()
  expect(
    screen.queryByRole('heading', { name: 'Email подтверждён' }),
  ).toBeNull()
})
