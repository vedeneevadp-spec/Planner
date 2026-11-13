import type { GooglePlayTestingState } from '@planner/contracts'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'

import { useGooglePlayTesting } from '../lib/hooks'
import { GooglePlayTestingBanner } from './GooglePlayTestingBanner'

vi.mock('../lib/hooks', () => ({ useGooglePlayTesting: vi.fn() }))
beforeEach(() => localStorage.clear())
afterEach(cleanup)
function state(revision: number) {
  vi.mocked(useGooglePlayTesting).mockReturnValue({
    enabled: true,
    session: { actorUserId: 'user' },
    query: {
      data: {
        isOpen: true,
        request: { status: 'invited', revision },
      } as GooglePlayTestingState,
    },
  } as unknown as ReturnType<typeof useGooglePlayTesting>)
}
it('remembers dismissal but shows a new invitation after the Google email changes', () => {
  state(2)
  const view = render(
    <MemoryRouter>
      <GooglePlayTestingBanner />
    </MemoryRouter>,
  )
  fireEvent.click(
    screen.getByRole('button', { name: 'Скрыть новость о Google Play' }),
  )
  view.unmount()
  const next = render(
    <MemoryRouter>
      <GooglePlayTestingBanner />
    </MemoryRouter>,
  )
  expect(
    screen.queryByRole('link', { name: 'Получить ссылки' }),
  ).not.toBeInTheDocument()
  state(4)
  next.rerender(
    <MemoryRouter>
      <GooglePlayTestingBanner />
    </MemoryRouter>,
  )
  expect(screen.getByRole('link', { name: 'Получить ссылки' })).toBeVisible()
})
