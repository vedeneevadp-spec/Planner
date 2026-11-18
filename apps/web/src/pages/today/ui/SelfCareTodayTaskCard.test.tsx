import type { SelfCareTodayItem } from '@planner/contracts'
import { cleanup, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { afterEach, describe, expect, it } from 'vitest'

import { SelfCareTodayTaskCard } from './SelfCareTodayTaskCard'

function createEntry(icon: string | null): SelfCareTodayItem {
  return {
    appointment: null,
    occurrence: null,
    scheduleRule: null,
    item: { icon, id: 'care-1', title: 'Йога' },
  } as unknown as SelfCareTodayItem
}

function renderCard(icon: string | null) {
  return render(
    <MemoryRouter>
      <SelfCareTodayTaskCard
        entry={createEntry(icon)}
        plannerTimeZone="Europe/Moscow"
        uploadedIcons={[]}
        variant="card"
      />
    </MemoryRouter>,
  )
}

describe('SelfCareTodayTaskCard', () => {
  afterEach(cleanup)

  it.each([null, 'image:missing-asset', 'credit-card'])(
    'does not show a done-looking check mark for icon %s',
    (icon) => {
      renderCard(icon)

      const link = screen.getByRole('link', { name: 'Открыть заботу: Йога' })

      expect(link).not.toHaveTextContent('✓')
      expect(link.querySelector('svg')).toBeInTheDocument()
    },
  )

  it('keeps an emoji icon as is', () => {
    renderCard('🧘')

    expect(
      screen.getByRole('link', { name: 'Открыть заботу: Йога' }),
    ).toHaveTextContent('🧘')
  })
})
