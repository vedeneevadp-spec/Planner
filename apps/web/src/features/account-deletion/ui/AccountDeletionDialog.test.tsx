import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { AccountDeletionDialog } from './AccountDeletionDialog'

describe('AccountDeletionDialog', () => {
  afterEach(cleanup)

  it('requires the account email after showing irreversible consequences', () => {
    const onConfirm = vi.fn()

    render(
      <AccountDeletionDialog
        displayName="Planner User"
        email="user@example.test"
        isOpen
        isPending={false}
        onCancel={vi.fn()}
        onConfirm={onConfirm}
      />,
    )

    expect(
      screen.getByText(
        /все связанные с ним данные будут безвозвратно удалены/i,
      ),
    ).toBeVisible()
    expect(screen.getByText(/резервные копии удаляются/i)).toBeVisible()

    const deleteButton = screen.getByRole('button', {
      name: 'Удалить навсегда',
    })

    expect(deleteButton).toBeDisabled()

    fireEvent.change(
      screen.getByRole('textbox', {
        name: 'Email для подтверждения удаления',
      }),
      { target: { value: 'user@example.test' } },
    )
    fireEvent.click(deleteButton)

    expect(onConfirm).toHaveBeenCalledTimes(1)
  })

  it('renders at the document root and locks page scrolling while open', () => {
    document.body.style.overflow = 'clip'

    const { rerender } = render(
      <AccountDeletionDialog
        displayName="Planner User"
        email="user@example.test"
        isOpen
        isPending={false}
        onCancel={vi.fn()}
        onConfirm={vi.fn()}
      />,
    )

    const dialog = screen.getByRole('alertdialog')

    expect(dialog.parentElement?.parentElement).toBe(document.body)
    expect(document.body.style.overflow).toBe('hidden')

    rerender(
      <AccountDeletionDialog
        displayName="Planner User"
        email="user@example.test"
        isOpen={false}
        isPending={false}
        onCancel={vi.fn()}
        onConfirm={vi.fn()}
      />,
    )

    expect(document.body.style.overflow).toBe('clip')
    document.body.style.overflow = ''
  })
})
