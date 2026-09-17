import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { useState } from 'react'
import { afterEach, describe, expect, it } from 'vitest'

import type { ResourceValue } from '../model/task-meta'
import { ResourcePicker, TaskResourceMeter } from './TaskMetaPickers'

afterEach(cleanup)

describe('ResourcePicker', () => {
  it('distinguishes an unrated task from neutral and can clear a rating', () => {
    function Picker() {
      const [value, setValue] = useState<ResourceValue>('')
      return <ResourcePicker value={value} onChange={setValue} />
    }
    render(<Picker />)
    const unrated = screen.getByRole('button', { name: 'Не указано' })
    const neutral = screen.getByRole('button', { name: 'Нейтрально' })
    expect(unrated).toHaveAttribute('aria-pressed', 'true')
    expect(neutral).toHaveAttribute('aria-pressed', 'false')
    fireEvent.click(neutral)
    expect(neutral).toHaveAttribute('aria-pressed', 'true')
    expect(unrated).toHaveAttribute('aria-pressed', 'false')
    fireEvent.click(screen.getByRole('button', { name: 'Расход 2' }))
    expect(neutral).toHaveAttribute('aria-pressed', 'false')
    fireEvent.click(unrated)
    expect(unrated).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('button', { name: 'Расход 2' })).toHaveAttribute(
      'aria-pressed',
      'false',
    )
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
