import { cleanup, render } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'

import { TodayFillerCard } from './TodayFillerCard'

describe('TodayFillerCard', () => {
  afterEach(cleanup)

  it('renders the phrase and summary as decoration hidden from assistive tech', () => {
    const { container } = render(
      <TodayFillerCard
        illustration="tea"
        phrase="Одно дело за раз — тоже план."
        summary={[
          { count: 3, kind: 'done' },
          { kind: 'next', time: '13:30', title: 'Дейли' },
          { count: 2, kind: 'sphere', name: 'Работа' },
        ]}
      />,
    )
    const slot = container.firstElementChild

    expect(slot).toHaveAttribute('aria-hidden', 'true')
    expect(slot).toHaveTextContent('Одно дело за раз — тоже план.')
    expect(slot).toHaveTextContent('Сегодня закрыто: 3')
    expect(slot).toHaveTextContent('Дальше в 13:30: Дейли')
    expect(slot).toHaveTextContent('Больше всего задач — «Работа»')
    expect(container.querySelectorAll('img')).toHaveLength(2)
  })

  it('omits the summary list when there is nothing to summarise', () => {
    const { container } = render(
      <TodayFillerCard illustration="notebook" phrase="Фраза" summary={[]} />,
    )

    expect(container.querySelector('ul')).toBeNull()
  })
})
