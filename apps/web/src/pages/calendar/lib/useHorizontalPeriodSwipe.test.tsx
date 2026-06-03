import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { useHorizontalPeriodSwipe } from './useHorizontalPeriodSwipe'

function SwipeHarness({
  enabled = true,
  onSwipeLeft,
  onSwipeRight,
}: {
  enabled?: boolean
  onSwipeLeft: () => void
  onSwipeRight: () => void
}) {
  const swipeHandlers = useHorizontalPeriodSwipe({
    enabled,
    onSwipeLeft,
    onSwipeRight,
  })

  return (
    <div data-testid="surface" {...swipeHandlers}>
      <div data-testid="empty-cell">Empty cell</div>
      <button data-no-swipe type="button">
        Task
      </button>
    </div>
  )
}

function renderSwipeHarness(options: { enabled?: boolean } = {}) {
  const onSwipeLeft = vi.fn()
  const onSwipeRight = vi.fn()

  render(
    <SwipeHarness
      enabled={options.enabled ?? true}
      onSwipeLeft={onSwipeLeft}
      onSwipeRight={onSwipeRight}
    />,
  )

  return {
    onSwipeLeft,
    onSwipeRight,
    surface: screen.getByTestId('surface'),
  }
}

function swipe(
  target: Element,
  {
    endX,
    endY = 105,
    pointerId = 1,
    startX,
    startY = 100,
  }: {
    endX: number
    endY?: number
    pointerId?: number
    startX: number
    startY?: number
  },
) {
  fireEvent.pointerDown(target, {
    button: 0,
    clientX: startX,
    clientY: startY,
    pointerId,
    pointerType: 'touch',
  })
  fireEvent.pointerUp(target, {
    clientX: endX,
    clientY: endY,
    pointerId,
    pointerType: 'touch',
  })
}

describe('useHorizontalPeriodSwipe', () => {
  afterEach(() => {
    cleanup()
  })

  it('calls onSwipeLeft for a horizontal left swipe', () => {
    const { onSwipeLeft, onSwipeRight, surface } = renderSwipeHarness()

    swipe(surface, { endX: 120, startX: 220 })

    expect(onSwipeLeft).toHaveBeenCalledTimes(1)
    expect(onSwipeRight).not.toHaveBeenCalled()
  })

  it('calls onSwipeRight for a horizontal right swipe', () => {
    const { onSwipeLeft, onSwipeRight, surface } = renderSwipeHarness()

    swipe(surface, { endX: 220, startX: 120 })

    expect(onSwipeRight).toHaveBeenCalledTimes(1)
    expect(onSwipeLeft).not.toHaveBeenCalled()
  })

  it('ignores short swipes', () => {
    const { onSwipeLeft, onSwipeRight, surface } = renderSwipeHarness()

    swipe(surface, { endX: 170, startX: 200 })

    expect(onSwipeLeft).not.toHaveBeenCalled()
    expect(onSwipeRight).not.toHaveBeenCalled()
  })

  it('ignores mostly vertical swipes', () => {
    const { onSwipeLeft, onSwipeRight, surface } = renderSwipeHarness()

    swipe(surface, { endX: 120, endY: 190, startX: 200, startY: 100 })

    expect(onSwipeLeft).not.toHaveBeenCalled()
    expect(onSwipeRight).not.toHaveBeenCalled()
  })

  it('ignores swipes that start on data-no-swipe elements', () => {
    const { onSwipeLeft, onSwipeRight } = renderSwipeHarness()

    swipe(screen.getByRole('button', { name: 'Task' }), {
      endX: 120,
      startX: 220,
    })

    expect(onSwipeLeft).not.toHaveBeenCalled()
    expect(onSwipeRight).not.toHaveBeenCalled()
  })

  it('does not trigger when disabled', () => {
    const { onSwipeLeft, onSwipeRight, surface } = renderSwipeHarness({
      enabled: false,
    })

    swipe(surface, { endX: 120, startX: 220 })

    expect(onSwipeLeft).not.toHaveBeenCalled()
    expect(onSwipeRight).not.toHaveBeenCalled()
  })
})
