import type { SelfCareTodayItem } from '@planner/contracts'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { TodayOverdueSelfCareGroup } from '../lib/today-self-care'
import { TodayMissedCareRow } from './TodayMissedCareRow'

function group(id: string, title: string): TodayOverdueSelfCareGroup {
  return {
    entry: { item: { id, title } } as unknown as SelfCareTodayItem,
    lastMissedDate: '2026-11-17',
    missedCount: 40,
  }
}

function renderRow(
  props: Partial<Parameters<typeof TodayMissedCareRow>[0]> = {},
) {
  const onRelease = vi.fn()
  render(
    <MemoryRouter>
      <TodayMissedCareRow
        groups={[group('yoga', 'Йога'), group('water', 'Вода')]}
        isReleasing={false}
        onRelease={onRelease}
        {...props}
      />
    </MemoryRouter>,
  )
  return { onRelease }
}

describe('TodayMissedCareRow', () => {
  afterEach(cleanup)

  it('summarises missed care without counting misses', () => {
    renderRow()

    expect(screen.getByText('Пропущенная забота · 2')).toBeVisible()
    expect(screen.getByText('Вчерашнее — уже прошлое')).toBeVisible()
    expect(screen.queryByText(/40/)).not.toBeInTheDocument()
    expect(screen.queryByRole('link')).not.toBeInTheDocument()
  })

  it('lists the habits as links to self-care when expanded', () => {
    renderRow()

    fireEvent.click(screen.getByRole('button', { name: /Пропущенная забота/ }))

    expect(
      screen.getByRole('link', { name: 'Открыть заботу: Йога' }),
    ).toHaveAttribute('href', '/self-care')
  })

  it('asks before releasing and lets the user back out', () => {
    const { onRelease } = renderRow()

    fireEvent.click(screen.getByRole('button', { name: 'Отпустить' }))
    fireEvent.click(screen.getByRole('button', { name: 'Не сейчас' }))
    expect(onRelease).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: 'Отпустить' }))
    fireEvent.click(screen.getByRole('button', { name: 'Отпустить' }))
    expect(onRelease).toHaveBeenCalledTimes(1)
  })

  it('shows a failed release and renders nothing without missed care', () => {
    renderRow({ errorMessage: 'Нет сети' })
    expect(screen.getByRole('alert')).toHaveTextContent('Нет сети')

    cleanup()
    const { container } = render(
      <MemoryRouter>
        <TodayMissedCareRow
          groups={[]}
          isReleasing={false}
          onRelease={vi.fn()}
        />
      </MemoryRouter>,
    )
    expect(container).toBeEmptyDOMElement()
  })
})
