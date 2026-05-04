import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { TaskResourceMeter } from './TaskMetaPickers'

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
