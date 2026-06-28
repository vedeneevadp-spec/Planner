import { cleanup, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'

import { ContactsPage } from './ContactsPage'

describe('ContactsPage', () => {
  afterEach(() => {
    cleanup()
  })

  it('shows support contacts with actionable links', () => {
    render(<ContactsPage />)

    const contacts = screen.getByRole('region', { name: 'Контакты' })

    expect(
      within(contacts).getByRole('link', { name: /support@chaotika\.ru/ }),
    ).toHaveAttribute('href', 'mailto:support@chaotika.ru')
    expect(
      within(contacts).getByText(
        'Если нужна помощь или хотите сообщить о проблеме, пишите на почту.',
      ),
    ).toBeVisible()
    expect(
      within(contacts).getByRole('link', { name: /@plan_chaosa/ }),
    ).toHaveAttribute('href', 'https://t.me/plan_chaosa')
    expect(
      within(contacts).getByText(
        'В канале можно получать свежие обновления и новости Chaotika.',
      ),
    ).toBeVisible()
    expect(
      within(contacts).getByRole('link', { name: /https:\/\/chaotika\.ru/ }),
    ).toHaveAttribute('href', 'https://chaotika.ru')
    expect(
      within(contacts).getByText('Также доступен веб-интерфейс Chaotika.'),
    ).toBeVisible()
  })
})
