import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { useState } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import * as nativeRuntime from '@/shared/lib/native-runtime'

import { TimePicker } from './TimePicker'

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe('TimePicker', () => {
  it('opens at the saved time, selects midnight and confirms an exact minute with arrow keys', () => {
    const onChange = vi.fn()
    render(<TimePicker label="Старт" value="13:39" onChange={onChange} />)
    const start = screen.getByRole('button', { name: 'Старт' })
    fireEvent.click(start)
    const clock = screen.getByRole('slider', { name: 'Часы на циферблате' })
    expect(clock).toHaveAttribute('aria-valuenow', '13')
    fireEvent.keyDown(clock, { key: 'Home' })
    fireEvent.keyDown(clock, { key: 'Enter' })
    expect(
      screen.getByRole('slider', { name: 'Минуты на циферблате' }),
    ).toHaveAttribute('aria-valuenow', '39')
    fireEvent.keyDown(clock, { key: 'ArrowLeft' })
    expect(onChange).not.toHaveBeenCalled()
    fireEvent.keyDown(clock, { key: 'Enter' })
    expect(onChange).toHaveBeenCalledExactlyOnceWith('00:38')
    expect(start).toHaveFocus()
  })

  it('keeps the saved time on cancellation and clears only on request', () => {
    const onChange = vi.fn()
    render(<TimePicker label="Финиш" value="23:59" onChange={onChange} />)
    const field = screen.getByRole('button', { name: 'Финиш' })
    fireEvent.click(field)
    fireEvent.click(screen.getByRole('button', { name: 'Минуты, 59' }))
    fireEvent.keyDown(screen.getByRole('slider'), { key: 'ArrowRight' })
    fireEvent.click(screen.getByRole('button', { name: 'Отмена' }))
    expect(onChange).not.toHaveBeenCalled()
    expect(field).toHaveTextContent('23:59')
    fireEvent.click(field)
    fireEvent.click(screen.getByRole('button', { name: 'Удалить время' }))
    expect(onChange).toHaveBeenCalledExactlyOnceWith('')
  })

  it('validates both keyboard fields and keeps the entered time when switching modes', () => {
    const onChange = vi.fn()
    render(<TimePicker label="Время" value="10:40" onChange={onChange} />)
    fireEvent.click(screen.getByRole('button', { name: 'Время' }))
    fireEvent.click(screen.getByRole('button', { name: 'Ввести с клавиатуры' }))
    const hours = screen.getByRole('textbox', { name: 'Часы' })
    const minutes = screen.getByRole('textbox', { name: 'Минуты' })
    expect(hours).toHaveFocus()
    fireEvent.change(hours, { target: { value: '24' } })
    fireEvent.change(minutes, { target: { value: '60' } })
    expect(hours).toHaveAttribute('aria-invalid', 'true')
    expect(minutes).toHaveAttribute('aria-invalid', 'true')
    expect(screen.getByRole('button', { name: 'Установить' })).toBeDisabled()
    fireEvent.keyDown(minutes, { key: 'Enter' })
    expect(onChange).not.toHaveBeenCalled()
    fireEvent.change(hours, { target: { value: '7' } })
    fireEvent.change(minutes, { target: { value: '3' } })
    fireEvent.click(
      screen.getByRole('button', { name: 'Выбрать на циферблате' }),
    )
    expect(screen.getByRole('button', { name: 'Часы, 07' })).toBeVisible()
    fireEvent.click(screen.getByRole('button', { name: 'Установить' }))
    expect(onChange).toHaveBeenCalledExactlyOnceWith('07:03')
  })

  it('enforces required time on the containing form', () => {
    function RequiredTime() {
      const [time, setTime] = useState('')
      return (
        <form aria-label="Расписание">
          <input type="text" required aria-label="Название" />
          <TimePicker label="Время" value={time} required onChange={setTime} />
          <button type="submit">Сохранить</button>
        </form>
      )
    }
    render(<RequiredTime />)
    fireEvent.click(screen.getByRole('button', { name: 'Сохранить' }))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    fireEvent.change(screen.getByLabelText('Название'), {
      target: { value: 'Прогулка' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Сохранить' }))
    expect(
      screen.getByRole('dialog', { name: 'Выбор времени — Время' }),
    ).toBeVisible()
    expect(
      screen.queryByRole('button', { name: 'Удалить время' }),
    ).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Установить' }))
    expect(screen.getByRole('form')).toBeValid()
  })

  it('uses the system time field on native Android', () => {
    vi.spyOn(nativeRuntime, 'isAndroidNativeRuntime').mockReturnValue(true)
    const onChange = vi.fn()
    render(<TimePicker label="Время" value="10:40" onChange={onChange} />)
    const input = screen.getByLabelText('Время')
    expect(input).toHaveAttribute('type', 'time')
    fireEvent.change(input, { target: { value: '00:01' } })
    expect(onChange).toHaveBeenCalledExactlyOnceWith('00:01')
  })
})
