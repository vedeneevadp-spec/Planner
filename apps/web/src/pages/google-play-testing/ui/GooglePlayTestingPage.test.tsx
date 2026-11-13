import type { GooglePlayTestingState } from '@planner/contracts'
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { useGooglePlayTesting } from '@/features/google-play-testing/lib/hooks'

import { GooglePlayTestingPage } from './GooglePlayTestingPage'

vi.mock('@/features/google-play-testing/lib/hooks', () => ({
  useGooglePlayTesting: vi.fn(),
}))
const submit = vi.fn()
const refresh = vi.fn()
function setState(state: GooglePlayTestingState) {
  vi.mocked(useGooglePlayTesting).mockReturnValue({
    enabled: true,
    session: { actorUserId: 'user' },
    query: { data: state, isError: false, refetch: refresh },
    submit: { mutateAsync: submit, isPending: false },
  } as unknown as ReturnType<typeof useGooglePlayTesting>)
}
const pending: GooglePlayTestingState = {
  isOpen: true,
  invitation: null,
  request: {
    userId: '44444444-4444-4444-8444-444444444444',
    googleEmail: 'tester@gmail.com',
    status: 'pending',
    revision: 1,
    createdAt: '2026-11-13T00:00:00.000Z',
    updatedAt: '2026-11-13T00:00:00.000Z',
  },
}
describe('GooglePlayTestingPage', () => {
  afterEach(cleanup)
  beforeEach(() => {
    submit.mockReset()
    refresh.mockReset()
  })
  it('submits the Google account rather than assuming the planner email, and keeps failed input', async () => {
    setState({ isOpen: true, request: null, invitation: null })
    submit.mockRejectedValueOnce(new Error('Набор участников сейчас закрыт.'))
    render(<GooglePlayTestingPage />)
    const input = screen.getByLabelText('Почта Google-аккаунта')
    fireEvent.change(input, { target: { value: 'Tester@Googlemail.com' } })
    fireEvent.click(screen.getByRole('button', { name: 'Отправить заявку' }))
    await waitFor(() =>
      expect(submit).toHaveBeenCalledWith('tester@googlemail.com'),
    )
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Набор участников сейчас закрыт.',
    )
    expect(input).toHaveValue('Tester@Googlemail.com')
  })
  it('only shows installation links after the server confirms an invitation, also after closure', () => {
    setState(pending)
    const view = render(<GooglePlayTestingPage />)
    expect(
      screen.queryByRole('link', { name: /Подключиться к тесту/ }),
    ).not.toBeInTheDocument()
    setState({
      ...pending,
      isOpen: false,
      request: { ...pending.request!, status: 'invited', revision: 2 },
      invitation: {
        joinUrl: 'https://play.google.com/apps/testing/ru.chaotika.app',
        downloadUrl:
          'https://play.google.com/store/apps/details?id=ru.chaotika.app',
      },
    })
    view.rerender(<GooglePlayTestingPage />)
    expect(
      screen.getByRole('link', { name: /1. Подключиться/ }),
    ).toHaveAttribute(
      'href',
      'https://play.google.com/apps/testing/ru.chaotika.app',
    )
    expect(screen.getByRole('link', { name: /2. Установить/ })).toBeVisible()
    expect(
      screen.queryByRole('button', { name: 'Изменить Google-почту' }),
    ).not.toBeInTheDocument()
  })
})
