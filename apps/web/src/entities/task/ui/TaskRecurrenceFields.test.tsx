import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { TaskRecurrenceFormState } from '../model/task-recurrence'
import { TaskRecurrenceFields } from './TaskRecurrenceFields'

describe('TaskRecurrenceFields', () => {
  afterEach(() => {
    cleanup()
  })

  it('enables recurrence and sanitizes interval input', () => {
    const onChange = vi.fn()
    const value = createRecurrenceValue({ isEnabled: false })

    render(<TaskRecurrenceFields value={value} onChange={onChange} />)

    fireEvent.click(screen.getByLabelText('Повторять задачу'))

    expect(onChange).toHaveBeenCalledWith({
      ...value,
      isEnabled: true,
    })
    expect(screen.queryByRole('button', { name: 'Тип повтора' })).toBeNull()

    cleanup()
    onChange.mockClear()

    render(
      <TaskRecurrenceFields
        value={createRecurrenceValue({ isEnabled: true, interval: 2 })}
        onChange={onChange}
      />,
    )

    fireEvent.change(screen.getByLabelText('Каждые'), {
      target: { value: '0' },
    })

    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({ interval: 1 }),
    )
  })

  it('resets days when frequency changes to weekly or monthly', () => {
    const onChange = vi.fn()
    const value = createRecurrenceValue({
      daysOfWeek: [6, 7],
      frequency: 'custom',
      isEnabled: true,
    })

    render(<TaskRecurrenceFields value={value} onChange={onChange} />)

    fireEvent.click(screen.getByRole('button', { name: 'Тип повтора' }))
    fireEvent.click(screen.getByRole('option', { name: 'Будни' }))

    expect(onChange).toHaveBeenCalledWith({
      ...value,
      daysOfWeek: [1, 2, 3, 4, 5],
      frequency: 'weekly',
    })

    cleanup()
    onChange.mockClear()

    render(<TaskRecurrenceFields value={value} onChange={onChange} />)

    fireEvent.click(screen.getByRole('button', { name: 'Тип повтора' }))
    fireEvent.click(screen.getByRole('option', { name: 'Месяцы' }))

    expect(onChange).toHaveBeenCalledWith({
      ...value,
      daysOfWeek: [1, 2, 3, 4, 5, 6, 7],
      frequency: 'monthly',
    })
  })

  it('lets custom recurrence toggle individual weekdays', () => {
    const onChange = vi.fn()
    const value = createRecurrenceValue({
      daysOfWeek: [1, 3],
      frequency: 'custom',
      isEnabled: true,
    })

    render(<TaskRecurrenceFields value={value} onChange={onChange} />)

    const daysGroup = screen.getByText('Дни недели').closest('div')

    if (!daysGroup) {
      throw new Error('Expected custom days group.')
    }

    fireEvent.click(within(daysGroup).getByText('Вт'))
    expect(onChange).toHaveBeenCalledWith({
      ...value,
      daysOfWeek: [1, 2, 3],
    })

    fireEvent.click(within(daysGroup).getByText('Пн'))
    expect(onChange).toHaveBeenCalledWith({
      ...value,
      daysOfWeek: [3],
    })
  })
})

function createRecurrenceValue(
  overrides: Partial<TaskRecurrenceFormState> = {},
): TaskRecurrenceFormState {
  return {
    daysOfWeek: [1, 2, 3, 4, 5, 6, 7],
    endDate: '',
    frequency: 'daily',
    interval: 1,
    isEnabled: false,
    ...overrides,
  }
}
