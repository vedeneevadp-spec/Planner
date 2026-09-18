import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { useState } from 'react'
import { afterEach, describe, expect, it } from 'vitest'

import type { ResourceValue } from '../model/task-meta'
import { ResourcePicker, TaskResourceMeter } from './TaskMetaPickers'

afterEach(cleanup)

describe('ResourcePicker', () => {
  it('offers only resource levels and clears the selected level on repeat click', () => {
    function Picker() {
      const [value, setValue] = useState<ResourceValue>('')
      return <ResourcePicker value={value} onChange={setValue} />
    }
    render(<Picker />)
    expect(screen.queryByRole('button', { name: 'Не указано' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Нейтрально' })).toBeNull()
    expect(screen.getAllByRole('button', { pressed: false })).toHaveLength(8)

    const drain = screen.getByRole('button', { name: 'Расход 2' })
    const restore = screen.getByRole('button', { name: 'Восстановление 3' })
    fireEvent.click(drain)
    expect(drain).toHaveAttribute('aria-pressed', 'true')
    fireEvent.click(restore)
    expect(drain).toHaveAttribute('aria-pressed', 'false')
    expect(restore).toHaveAttribute('aria-pressed', 'true')
    fireEvent.click(restore)
    expect(screen.getAllByRole('button', { pressed: false })).toHaveLength(8)
  })
})

describe('TaskResourceMeter', () => {
  it('caps legacy draining values at the current limit', () => {
    const { container } = render(<TaskResourceMeter value={-5} />)

    expect(screen.getByRole('img', { name: 'Расход 4' })).toBeInTheDocument()
    expect(container.querySelectorAll('svg')).toHaveLength(4)
  })

  it('caps legacy restoring values at the current limit', () => {
    const { container } = render(<TaskResourceMeter value={5} />)

    expect(
      screen.getByRole('img', { name: 'Восстановление 4' }),
    ).toBeInTheDocument()
    expect(container.querySelectorAll('svg')).toHaveLength(4)
  })
})
