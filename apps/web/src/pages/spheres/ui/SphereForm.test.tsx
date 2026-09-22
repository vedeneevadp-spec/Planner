import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { SphereForm } from './SphereForm'

afterEach(cleanup)

describe('SphereForm', () => {
  it('prevents repeated submissions and retains the draft with a visible error for retry', async () => {
    let finish!: (saved: boolean) => void
    const onSubmit = vi.fn(
      () =>
        new Promise<boolean>((resolve) => {
          finish = resolve
        }),
    )
    render(<SphereForm submitLabel="Создать сферу" onSubmit={onSubmit} />)
    fireEvent.change(screen.getByLabelText('Название'), {
      target: { value: 'Здоровье' },
    })
    const form = screen.getByRole('form', { name: 'Новая сфера' })
    fireEvent.submit(form)
    fireEvent.submit(form)
    expect(onSubmit).toHaveBeenCalledTimes(1)
    expect(screen.getByRole('button', { name: 'Сохраняем...' })).toBeDisabled()
    await act(async () => {
      finish(false)
      await Promise.resolve()
    })
    expect(screen.getByRole('alert')).toHaveTextContent(
      'Не удалось сохранить сферу',
    )
    expect(screen.getByLabelText('Название')).toHaveValue('Здоровье')
    fireEvent.submit(form)
    expect(onSubmit).toHaveBeenCalledTimes(2)
    await act(async () => {
      finish(true)
      await Promise.resolve()
    })
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(screen.getByLabelText('Название')).toHaveValue('')
  })
})
