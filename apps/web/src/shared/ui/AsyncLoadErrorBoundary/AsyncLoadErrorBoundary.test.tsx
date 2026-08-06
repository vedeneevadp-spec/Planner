import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { AsyncLoadErrorBoundary } from './AsyncLoadErrorBoundary'

describe('AsyncLoadErrorBoundary', () => {
  afterEach(cleanup)

  it('shows a safe fallback when a lazy child cannot load', () => {
    const onError = vi.fn()

    render(
      <AsyncLoadErrorBoundary
        fallback={<p>Раздел недоступен</p>}
        onError={onError}
      >
        <ThrowingChild />
      </AsyncLoadErrorBoundary>,
    )

    expect(screen.getByText('Раздел недоступен')).toBeVisible()
    expect(onError).toHaveBeenCalledTimes(1)
  })

  it('resets the fallback after navigation changes its reset key', () => {
    const { rerender } = render(
      <AsyncLoadErrorBoundary
        fallback={<p>Раздел недоступен</p>}
        resetKey="first"
      >
        <ThrowingChild />
      </AsyncLoadErrorBoundary>,
    )

    rerender(
      <AsyncLoadErrorBoundary
        fallback={<p>Раздел недоступен</p>}
        resetKey="second"
      >
        <p>Другой раздел</p>
      </AsyncLoadErrorBoundary>,
    )

    expect(screen.getByText('Другой раздел')).toBeVisible()
    expect(screen.queryByText('Раздел недоступен')).not.toBeInTheDocument()
  })
})

function ThrowingChild(): never {
  throw new Error('Chunk load failed')
}
