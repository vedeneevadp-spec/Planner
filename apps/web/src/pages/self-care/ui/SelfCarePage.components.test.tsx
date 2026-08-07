import type {
  SelfCareDashboardResponse,
  SelfCareListResponse,
  SelfCarePlanResponse,
} from '@planner/contracts'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  SelfCarePlanTab,
  SelfCareRitualsTab,
  SelfCareTodayTab,
} from './SelfCarePage.components'

describe('Self-care tab states', () => {
  afterEach(() => {
    cleanup()
  })

  it('shows a meaningful single-action empty state for All care', () => {
    const onAddCare = vi.fn()

    render(
      <SelfCareRitualsTab
        canAddCare
        dashboardItems={[]}
        history={undefined}
        isBusy={false}
        isAddingCare={false}
        list={createEmptyList()}
        plan={undefined}
        ritualStepDrafts={{}}
        todayKey="2026-08-06"
        uploadedIcons={[]}
        onAddCare={onAddCare}
        onArchiveItem={vi.fn()}
        onCardAction={vi.fn()}
        onEditItem={vi.fn()}
        onRestartCourse={vi.fn()}
        onToggleRitualStep={vi.fn()}
      />,
    )

    expect(
      screen.getByRole('heading', { name: 'Здесь пока нет забот' }),
    ).toBeInTheDocument()
    expect(
      screen.getByText(
        'Можно добавить первую заботу, которую хочется держать под рукой.',
      ),
    ).toBeInTheDocument()

    const actions = screen.getAllByRole('button')
    expect(actions).toHaveLength(1)
    fireEvent.click(actions[0]!)
    expect(onAddCare).toHaveBeenCalledTimes(1)
  })

  it('keeps the All care action visible and disabled while adding', () => {
    const onAddCare = vi.fn()

    render(
      <SelfCareRitualsTab
        canAddCare
        dashboardItems={[]}
        history={undefined}
        isBusy
        isAddingCare
        list={createEmptyList()}
        plan={undefined}
        ritualStepDrafts={{}}
        todayKey="2026-08-06"
        uploadedIcons={[]}
        onAddCare={onAddCare}
        onArchiveItem={vi.fn()}
        onCardAction={vi.fn()}
        onEditItem={vi.fn()}
        onRestartCourse={vi.fn()}
        onToggleRitualStep={vi.fn()}
      />,
    )

    const action = screen.getByRole('button', { name: 'Добавляем…' })
    expect(action).toBeDisabled()
    expect(action).toHaveAttribute('aria-busy', 'true')
    fireEvent.click(action)
    expect(onAddCare).not.toHaveBeenCalled()
  })

  it('keeps the Plan action visible and disabled while adding', () => {
    render(
      <SelfCarePlanTab
        canAddCare
        hiddenScheduledItemIds={new Set()}
        history={undefined}
        isBusy
        isAddingCare
        plan={createEmptyPlan()}
        todayKey="2026-08-06"
        uploadedIcons={[]}
        onAddCare={vi.fn()}
        onArchiveItem={vi.fn()}
        onCancelOccurrence={vi.fn()}
        onCardAction={vi.fn()}
        onEditItem={vi.fn()}
        onRestartCourse={vi.fn()}
        onScheduleItem={vi.fn()}
      />,
    )

    const action = screen.getByRole('button', { name: 'Добавляем…' })
    expect(action).toBeDisabled()
    expect(action).toHaveAttribute('aria-busy', 'true')
    expect(screen.getAllByRole('button')).toHaveLength(1)
  })

  it('does not replace an already loaded Today dashboard with a second text loader', () => {
    render(
      <SelfCareTodayTab
        canAddCare
        dashboard={createEmptyDashboard()}
        hiddenScheduledItemIds={new Set()}
        history={undefined}
        isBusy={false}
        isAddingCare={false}
        list={undefined}
        plan={undefined}
        ritualStepDrafts={{}}
        todayKey="2026-08-06"
        uploadedIcons={[]}
        onAddCare={vi.fn()}
        onArchiveItem={vi.fn()}
        onCardAction={vi.fn()}
        onEditItem={vi.fn()}
        onRestartCourse={vi.fn()}
        onScheduleItem={vi.fn()}
        onShowHistory={vi.fn()}
        onShowPlan={vi.fn()}
        onSkipOccurrence={vi.fn()}
        onToggleRitualStep={vi.fn()}
      />,
    )

    expect(
      screen.queryByText('Загружаем доступные на сегодня действия.'),
    ).not.toBeInTheDocument()
    expect(
      screen.getByRole('heading', { name: 'Сегодня спокойно' }),
    ).toBeInTheDocument()
  })
})

function createEmptyList(): SelfCareListResponse {
  return {
    alternatives: [],
    appointmentDetails: [],
    courseDetails: [],
    exerciseDetails: [],
    items: [],
    medicalDetails: [],
    measurementDetails: [],
    procedureDetails: [],
    scheduleRules: [],
    steps: [],
  }
}

function createEmptyPlan(): SelfCarePlanResponse {
  return {
    courses: [],
    from: '2026-08-06',
    medical: [],
    occurrences: [],
    planningHints: [],
    to: '2026-08-12',
  }
}

function createEmptyDashboard(): SelfCareDashboardResponse {
  return {
    dailyState: null,
    date: '2026-08-06',
    flexibleGoals: [],
    gentleMode: false,
    minimumItems: [],
    overdueItems: [],
    planningHints: [],
    settings: {
      currency: 'RUB',
    } as SelfCareDashboardResponse['settings'],
    todayItems: [],
    upcomingImportant: [],
  }
}
