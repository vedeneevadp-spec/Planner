import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { afterEach, expect, it, vi } from 'vitest'

import { useGooglePlayTestingAdmin } from '../lib/hooks'
import { GooglePlayTestingAdmin } from './GooglePlayTestingAdmin'

vi.mock('../lib/hooks', () => ({ useGooglePlayTestingAdmin: vi.fn() }))
afterEach(cleanup)
it('requires confirming addition in Play Console before issuing links and includes a usable Telegram invitation', () => {
  const review = vi.fn().mockResolvedValue({})
  const settings = vi.fn()
  vi.mocked(useGooglePlayTestingAdmin).mockReturnValue({
    enabled: true,
    query: {
      data: {
        isOpen: false,
        requests: [
          {
            userId: 'user',
            googleEmail: 'tester@example.test',
            status: 'pending',
            revision: 3,
          },
        ],
      },
    },
    settings: { mutate: settings, isPending: false },
    review: { mutateAsync: review, isPending: false },
  } as unknown as ReturnType<typeof useGooglePlayTestingAdmin>)
  render(
    <MemoryRouter>
      <GooglePlayTestingAdmin />
    </MemoryRouter>,
  )
  fireEvent.click(
    screen.getByRole('button', { name: 'Показать объявление и открыть набор' }),
  )
  expect(settings).toHaveBeenCalledWith(true)
  fireEvent.click(screen.getByRole('button', { name: 'Открыть доступ' }))
  const confirm = screen.getByRole('button', {
    name: 'Подтвердить и показать ссылки',
  })
  expect(confirm).toBeDisabled()
  expect(review).not.toHaveBeenCalled()
  fireEvent.click(screen.getByRole('checkbox'))
  fireEvent.click(confirm)
  expect(review).toHaveBeenCalledWith({
    userId: 'user',
    revision: 3,
    status: 'invited',
  })
  expect(
    screen.getByLabelText<HTMLTextAreaElement>('Текст поста').value,
  ).toContain('https://chaotika.ru/google-play-testing')
})
