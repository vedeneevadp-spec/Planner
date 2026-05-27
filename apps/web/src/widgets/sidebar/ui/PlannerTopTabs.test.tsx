import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter, useLocation } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import styles from './PlannerTabs.module.css'
import { PlannerTopTabs } from './PlannerTopTabs'

interface PlannerTopTabsAuthStub {
  userId: string
}

interface PlannerTopTabsSessionStub {
  data:
    | {
        actorUserId: string
        workspaceId: string
        workspaces: Array<{
          id: string
          kind: 'personal' | 'shared'
          name: string
        }>
      }
    | undefined
}

const sessionMocks = vi.hoisted(() => ({
  setSelectedWorkspaceIdForActors: vi.fn(),
  usePlannerSession: vi.fn<() => PlannerTopTabsSessionStub>(),
  useSessionAuth: vi.fn<() => PlannerTopTabsAuthStub>(),
}))

vi.mock('@/features/session', () => ({
  setSelectedWorkspaceIdForActors: sessionMocks.setSelectedWorkspaceIdForActors,
  usePlannerSession: () => sessionMocks.usePlannerSession(),
  useSessionAuth: () => sessionMocks.useSessionAuth(),
}))

function LocationProbe() {
  const location = useLocation()

  return (
    <output data-testid="location">
      {location.pathname}
      {location.search}
    </output>
  )
}

function renderPlannerTopTabs(initialEntry: string) {
  return render(
    <MemoryRouter initialEntries={[initialEntry]}>
      <PlannerTopTabs />
      <LocationProbe />
    </MemoryRouter>,
  )
}

function requireClassName(className: string | undefined): string {
  if (!className) {
    throw new Error('Expected CSS module class to be available.')
  }

  return className
}

describe('PlannerTopTabs', () => {
  beforeEach(() => {
    sessionMocks.setSelectedWorkspaceIdForActors.mockClear()
    sessionMocks.usePlannerSession.mockReturnValue({
      data: {
        actorUserId: 'actor-user-1',
        workspaceId: 'personal-workspace',
        workspaces: [
          {
            id: 'personal-workspace',
            kind: 'personal',
            name: 'Personal Workspace',
          },
          {
            id: 'shared-workspace',
            kind: 'shared',
            name: 'Family Workspace',
          },
        ],
      },
    })
    sessionMocks.useSessionAuth.mockReturnValue({
      userId: 'auth-user-1',
    })
  })

  afterEach(() => {
    cleanup()
  })

  it('shows the list view switcher on today', () => {
    renderPlannerTopTabs('/today?foo=bar')

    expect(screen.getByRole('button', { name: 'Создать задачу' })).toBeVisible()
    expect(
      screen.getByRole('button', { name: 'Показать задачи списком' }),
    ).toBeVisible()
  })

  it('opens task creation through a query trigger', () => {
    renderPlannerTopTabs('/today?foo=bar')

    fireEvent.click(screen.getByRole('button', { name: 'Создать задачу' }))

    expect(screen.getByTestId('location').textContent).toContain(
      '/today?foo=bar&createTask=',
    )
  })

  it('toggles only the task view query parameter', () => {
    renderPlannerTopTabs('/today?foo=bar')

    fireEvent.click(
      screen.getByRole('button', { name: 'Показать задачи списком' }),
    )

    expect(screen.getByTestId('location')).toHaveTextContent(
      '/today?foo=bar&taskView=list',
    )

    fireEvent.click(
      screen.getByRole('button', { name: 'Показать задачи плитками' }),
    )

    expect(screen.getByTestId('location')).toHaveTextContent('/today?foo=bar')
  })

  it('normalizes unknown task views to cards', () => {
    renderPlannerTopTabs('/today?taskView=cards')

    expect(
      screen.getByRole('button', { name: 'Показать задачи списком' }),
    ).toBeVisible()
  })

  it('keeps the task view switcher hidden for routes without task view', () => {
    renderPlannerTopTabs('/calendar')

    expect(
      screen.queryByRole('button', { name: 'Показать задачи списком' }),
    ).not.toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: 'Показать задачи плитками' }),
    ).not.toBeInTheDocument()
  })

  it('shows calendar view tabs on calendar', () => {
    renderPlannerTopTabs('/calendar')

    expect(screen.getByRole('button', { name: 'Создать задачу' })).toBeVisible()
    expect(screen.getByRole('tablist', { name: 'Вид календаря' })).toBeVisible()
    expect(screen.getByRole('tab', { name: 'День' })).toBeVisible()
    expect(screen.getByRole('tab', { name: 'Неделя' })).toHaveAttribute(
      'aria-selected',
      'true',
    )
    expect(screen.getByRole('tab', { name: 'Месяц' })).toBeVisible()
    expect(screen.getByRole('tab', { name: 'Расписание' })).toBeVisible()
  })

  it('opens calendar task creation through a query trigger', () => {
    renderPlannerTopTabs('/calendar?foo=bar&calendarView=month')

    fireEvent.click(screen.getByRole('button', { name: 'Создать задачу' }))

    expect(screen.getByTestId('location').textContent).toContain(
      '/calendar?foo=bar&calendarView=month&createTask=',
    )
  })

  it('toggles only the calendar view query parameter', () => {
    renderPlannerTopTabs('/calendar?foo=bar')

    fireEvent.click(screen.getByRole('tab', { name: 'День' }))

    expect(screen.getByTestId('location')).toHaveTextContent(
      '/calendar?foo=bar&calendarView=day',
    )

    fireEvent.click(screen.getByRole('tab', { name: 'Месяц' }))

    expect(screen.getByTestId('location')).toHaveTextContent(
      '/calendar?foo=bar&calendarView=month',
    )

    fireEvent.click(screen.getByRole('tab', { name: 'Расписание' }))

    expect(screen.getByTestId('location')).toHaveTextContent(
      '/calendar?foo=bar&calendarView=schedule',
    )
  })

  it('normalizes unknown calendar views to week', () => {
    renderPlannerTopTabs('/calendar?calendarView=unknown')

    expect(screen.getByRole('tab', { name: 'Неделя' })).toHaveAttribute(
      'aria-selected',
      'true',
    )
  })

  it('shows cleaning filter tabs on cleaning', () => {
    renderPlannerTopTabs('/cleaning')

    const cleaningGroup = screen.getByRole('group', { name: 'Режим уборки' })
    const settingsLink = screen.getByRole('link', { name: 'Настройки зон' })

    expect(cleaningGroup).toBeVisible()
    expect(settingsLink).toHaveAttribute('href', '/cleaning/settings')
    expect(cleaningGroup.firstElementChild).toBe(settingsLink)
    expect(
      screen.getByRole('button', { name: 'Показать все задачи' }),
    ).toHaveAttribute('aria-pressed', 'true')
    expect(
      screen.queryByRole('button', { name: 'Показать задачи на 15 минут' }),
    ).not.toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: 'Показать низкий приоритет' }),
    ).toBeVisible()
    expect(
      screen.getByRole('button', { name: 'Показать обычный приоритет' }),
    ).toBeVisible()
    expect(
      screen.getByRole('button', { name: 'Показать важные задачи' }),
    ).toBeVisible()
  })

  it('toggles only the cleaning mode query parameter', () => {
    renderPlannerTopTabs('/cleaning?foo=bar')

    fireEvent.click(
      screen.getByRole('button', { name: 'Показать низкий приоритет' }),
    )

    expect(screen.getByTestId('location')).toHaveTextContent(
      '/cleaning?foo=bar&cleaningMode=low',
    )

    fireEvent.click(screen.getByRole('button', { name: 'Показать все задачи' }))

    expect(screen.getByTestId('location')).toHaveTextContent(
      '/cleaning?foo=bar',
    )
  })

  it('normalizes removed cleaning filter values to all', () => {
    renderPlannerTopTabs('/cleaning?cleaningMode=minimum')

    expect(
      screen.getByRole('button', { name: 'Показать все задачи' }),
    ).toHaveAttribute('aria-pressed', 'true')
    expect(
      screen.queryByRole('button', { name: 'Показать задачи на 15 минут' }),
    ).not.toBeInTheDocument()
  })

  it('shows a return tab on cleaning settings routes', () => {
    renderPlannerTopTabs('/cleaning/settings')

    expect(
      screen.queryByRole('group', { name: 'Режим уборки' }),
    ).not.toBeInTheDocument()
    expect(
      screen.getByRole('group', { name: 'Действия настроек уборки' }),
    ).toBeVisible()
    expect(screen.getByRole('link', { name: 'К уборке' })).toHaveAttribute(
      'href',
      '/cleaning',
    )
  })

  it('shows shopping filter tabs on shopping', () => {
    renderPlannerTopTabs('/shopping')

    expect(screen.getByRole('group', { name: 'Фильтр покупок' })).toBeVisible()
    expect(screen.getByRole('button', { name: 'Все' })).toHaveAttribute(
      'aria-pressed',
      'true',
    )
    expect(screen.getByRole('button', { name: 'Продукты' })).toBeVisible()
    expect(screen.getByRole('button', { name: 'Бытовое' })).toBeVisible()
    expect(screen.getByRole('button', { name: 'Прочее' })).toBeVisible()
    expect(screen.getByRole('button', { name: 'Избранное' })).toBeVisible()
    expect(screen.getByRole('button', { name: 'Срочное' })).toBeVisible()
  })

  it('toggles only shopping filter query parameters', () => {
    renderPlannerTopTabs('/shopping?foo=bar')

    fireEvent.click(screen.getByRole('button', { name: 'Продукты' }))

    expect(screen.getByTestId('location')).toHaveTextContent(
      '/shopping?foo=bar&shoppingCategory=groceries',
    )

    fireEvent.click(screen.getByRole('button', { name: 'Избранное' }))

    expect(screen.getByTestId('location')).toHaveTextContent(
      '/shopping?foo=bar&shoppingCategory=groceries&shoppingFavorite=1',
    )

    fireEvent.click(screen.getByRole('button', { name: 'Все' }))

    expect(screen.getByTestId('location')).toHaveTextContent(
      '/shopping?foo=bar',
    )
  })

  it('shows a sphere creation tab on spheres', () => {
    renderPlannerTopTabs('/spheres')

    expect(screen.getByRole('group', { name: 'Действия сфер' })).toBeVisible()
    expect(
      screen.getByRole('button', { name: 'Создать действие' }),
    ).toBeVisible()
    expect(screen.getByRole('button', { name: 'Создать сферу' })).toBeVisible()
  })

  it('opens task creation from the spheres tab through a query trigger', () => {
    renderPlannerTopTabs('/spheres?foo=bar')

    fireEvent.click(screen.getByRole('button', { name: 'Создать действие' }))

    expect(screen.getByTestId('location').textContent).toContain(
      '/spheres?foo=bar&createTask=',
    )
  })

  it('opens sphere creation through a query trigger', () => {
    renderPlannerTopTabs('/spheres?foo=bar')

    fireEvent.click(screen.getByRole('button', { name: 'Создать сферу' }))

    expect(screen.getByTestId('location').textContent).toContain(
      '/spheres?foo=bar&spheresAction=sphere&spheresActionRequest=',
    )
  })

  it('shows a habit creation tab on habits', () => {
    renderPlannerTopTabs('/habits')

    expect(
      screen.getByRole('group', { name: 'Действия привычек' }),
    ).toBeVisible()
    expect(
      screen.getByRole('button', { name: 'Создать привычку' }),
    ).toBeVisible()
  })

  it('opens habit creation through a query trigger', () => {
    renderPlannerTopTabs('/habits?foo=bar')

    fireEvent.click(screen.getByRole('button', { name: 'Создать привычку' }))

    expect(screen.getByTestId('location').textContent).toContain(
      '/habits?foo=bar&habitsAction=habit&habitsActionRequest=',
    )
  })

  it('keeps the home tab for routes without planner task view', () => {
    renderPlannerTopTabs('/calendar')

    expect(
      screen.getByRole('navigation', {
        name: 'Верхние действия планера',
      }),
    ).toBeVisible()
    expect(
      screen.getByRole('link', { name: 'Chaotika, перейти на сегодня' }),
    ).toHaveAttribute('href', '/today')
  })

  it('shows and updates the desktop workspace switcher', () => {
    renderPlannerTopTabs('/calendar')

    const workspaceButton = screen.getByRole('button', { name: 'Workspace' })

    expect(workspaceButton).toHaveTextContent('Personal Workspace')

    fireEvent.click(workspaceButton)
    fireEvent.click(screen.getByRole('option', { name: 'Family Workspace' }))

    expect(sessionMocks.setSelectedWorkspaceIdForActors).toHaveBeenCalledWith(
      'shared-workspace',
      ['auth-user-1', 'actor-user-1'],
    )
  })

  it('marks dense mobile routes to hide the visual brand text', () => {
    const noMobileBrandClass = requireClassName(styles.topTabsNoMobileBrand)

    for (const route of [
      '/calendar',
      '/shopping',
      '/cleaning',
      '/cleaning/settings',
    ]) {
      const { unmount } = renderPlannerTopTabs(route)

      expect(
        screen.getByRole('navigation', {
          name: 'Верхние действия планера',
        }),
      ).toHaveClass(noMobileBrandClass)

      unmount()
    }
  })

  it('keeps the visual brand text modifier off today', () => {
    renderPlannerTopTabs('/today')

    expect(
      screen.getByRole('navigation', {
        name: 'Верхние действия планера',
      }),
    ).not.toHaveClass(requireClassName(styles.topTabsNoMobileBrand))
  })

  it('keeps the home tab for today', () => {
    renderPlannerTopTabs('/today')

    expect(
      screen.getByRole('link', { name: 'Chaotika, перейти на сегодня' }),
    ).toHaveAttribute('href', '/today')
    expect(screen.getByText('Chaotika')).toBeVisible()
  })
})
