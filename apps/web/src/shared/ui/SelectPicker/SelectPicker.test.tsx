import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'

import { SelectPicker } from './SelectPicker'

afterEach(cleanup)

it('navigates enabled options by keyboard and restores the trigger after choosing or cancelling', () => {
  const onChange = vi.fn()
  render(
    <SelectPicker
      ariaLabel="Choice"
      value="a"
      onChange={onChange}
      options={[
        { value: 'a', label: 'First' },
        { value: 'b', label: 'Disabled', disabled: true },
        { value: 'c', label: 'Last' },
      ]}
    />,
  )
  const trigger = screen.getByRole('button', { name: 'Choice' })
  trigger.focus()
  fireEvent.keyDown(trigger, { key: 'ArrowDown' })
  const first = screen.getByRole('option', { name: 'First' })
  const last = screen.getByRole('option', { name: 'Last' })
  expect(first).toHaveFocus()
  fireEvent.keyDown(first, { key: 'ArrowDown' })
  expect(last).toHaveFocus()
  fireEvent.keyDown(last, { key: 'Home' })
  expect(first).toHaveFocus()
  fireEvent.keyDown(first, { key: 'End' })
  expect(last).toHaveFocus()
  fireEvent.click(last)
  expect(onChange).toHaveBeenCalledWith('c')
  expect(trigger).toHaveFocus()
  fireEvent.click(trigger)
  fireEvent.keyDown(screen.getByRole('option', { name: 'First' }), {
    key: 'Escape',
  })
  expect(screen.queryByRole('listbox')).not.toBeInTheDocument()
  expect(trigger).toHaveFocus()
})
