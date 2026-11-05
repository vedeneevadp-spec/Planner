import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { AndroidShareDialog } from './AndroidShareDialog'

const props = {
  initialKind: 'task' as const,
  initialTitle: 'Забрать посылку',
  originalText: 'Забрать посылку в пункте выдачи у дома',
  url: null,
  initialWorkspaceId: 'home',
  workspaces: [
    { id: 'home', name: 'Личное' },
    { id: 'family', name: 'Семья' },
  ],
  error: null,
  busy: false,
  onCancel: vi.fn(),
  onSave: vi.fn(),
}

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('AndroidShareDialog', () => {
  it('keeps the full source and sends the edited title, selected deadline and workspace on confirmation', () => {
    render(<AndroidShareDialog {...props} />)
    expect(screen.getByText(props.originalText)).not.toBeVisible()
    fireEvent.click(screen.getByText('Исходный текст'))
    expect(screen.getByText(props.originalText)).toBeVisible()
    fireEvent.change(screen.getByLabelText('Название'), {
      target: { value: ' Посылка ' },
    })
    fireEvent.change(screen.getByLabelText('Пространство'), {
      target: { value: 'family' },
    })
    fireEvent.change(screen.getByLabelText('Срок'), {
      target: { value: '2026-11-06' },
    })
    expect(props.onSave).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Добавить задачу' }))
    expect(props.onSave).toHaveBeenCalledWith({
      kind: 'task',
      title: 'Посылка',
      workspaceId: 'family',
      dueDate: '2026-11-06',
      shoppingCategory: 'other',
    })
  })

  it('keeps the product URL visible and the edited fields when switching record types and retrying', () => {
    const url = 'https://shop.example/item/350'
    const purchase = {
      ...props,
      initialKind: 'purchase' as const,
      initialTitle: 'Термокружка',
      originalText: url,
      url,
    }
    const { rerender } = render(<AndroidShareDialog {...purchase} />)
    expect(screen.getByText(url)).toBeVisible()
    expect(screen.queryByText('Исходный текст')).not.toBeInTheDocument()
    fireEvent.change(screen.getByLabelText('Название'), {
      target: { value: 'Кружка' },
    })
    fireEvent.change(screen.getByLabelText('Категория'), {
      target: { value: 'household' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Задачу' }))
    expect(screen.getByLabelText('Срок')).toBeVisible()
    expect(screen.queryByLabelText('Категория')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Покупку' }))
    rerender(<AndroidShareDialog {...purchase} error="Попробуйте ещё раз" />)
    expect(screen.getByRole('alert')).toHaveTextContent('Попробуйте ещё раз')
    expect(screen.getByLabelText('Категория')).toHaveValue('household')
    expect(screen.getByLabelText('Название')).toHaveValue('Кружка')
    fireEvent.click(screen.getByRole('button', { name: 'Добавить покупку' }))
    expect(props.onSave).toHaveBeenCalledWith({
      kind: 'purchase',
      title: 'Кружка',
      workspaceId: 'home',
      dueDate: null,
      shoppingCategory: 'household',
    })
  })

  it('blocks blank titles and stale workspaces, allows cancellation, and locks the draft while saving', () => {
    const { rerender } = render(<AndroidShareDialog {...props} />)
    fireEvent.change(screen.getByLabelText('Название'), {
      target: { value: '   ' },
    })
    expect(
      screen.getByRole('button', { name: 'Добавить задачу' }),
    ).toBeDisabled()
    fireEvent.click(screen.getByRole('button', { name: 'Отмена' }))
    expect(props.onCancel).toHaveBeenCalledOnce()
    fireEvent.change(screen.getByLabelText('Название'), {
      target: { value: 'Задача' },
    })
    rerender(
      <AndroidShareDialog {...props} workspaces={[props.workspaces[1]!]} />,
    )
    expect(
      screen.getByRole('button', { name: 'Добавить задачу' }),
    ).toBeDisabled()
    rerender(<AndroidShareDialog {...props} busy />)
    expect(screen.getByRole('button', { name: 'Сохраняем…' })).toBeDisabled()
    expect(screen.getByLabelText('Название')).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Отмена' })).toBeDisabled()
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' })
    expect(props.onCancel).toHaveBeenCalledOnce()
  })
})
