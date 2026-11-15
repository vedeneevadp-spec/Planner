import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'

const loading = vi.hoisted(() => {
  let finish!: () => void
  const pending = new Promise<void>((resolve) => {
    finish = resolve
  })
  return { finish, pending, load: vi.fn() }
})

vi.mock('./WorkspaceParticipantsDialog', async () => {
  loading.load()
  await loading.pending
  return {
    WorkspaceParticipantsDialog: ({ onClose }: { onClose: () => void }) => (
      <div role="dialog" aria-label="Loaded participants">
        <button onClick={onClose}>Close loaded</button>
      </div>
    ),
  }
})

import { LazyWorkspaceParticipantsDialog } from './LazyWorkspaceParticipantsDialog'

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

it('loads only when opened, offers a cancellable status, and stays closed if loading finishes later', async () => {
  vi.spyOn(HTMLDialogElement.prototype, 'showModal').mockImplementation(
    function (this: HTMLDialogElement) {
      this.setAttribute('open', '')
    },
  )
  vi.spyOn(HTMLDialogElement.prototype, 'close').mockImplementation(function (
    this: HTMLDialogElement,
  ) {
    this.removeAttribute('open')
  })
  const onClose = vi.fn()
  const { rerender } = render(
    <LazyWorkspaceParticipantsDialog isOpen={false} onClose={onClose} />,
  )
  expect(loading.load).not.toHaveBeenCalled()
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  rerender(<LazyWorkspaceParticipantsDialog isOpen onClose={onClose} />)
  expect(screen.getByRole('status')).toHaveTextContent('Загружаем участников')
  fireEvent.click(screen.getByRole('button', { name: 'Закрыть' }))
  expect(onClose).toHaveBeenCalledOnce()
  rerender(<LazyWorkspaceParticipantsDialog isOpen={false} onClose={onClose} />)
  await act(async () => {
    loading.finish()
    await loading.pending
  })
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  rerender(<LazyWorkspaceParticipantsDialog isOpen onClose={onClose} />)
  expect(
    await screen.findByRole('dialog', { name: 'Loaded participants' }),
  ).toBeVisible()
  expect(loading.load).toHaveBeenCalledOnce()
})
