import type {
  SelfCareDashboardResponse,
  SelfCareItem,
  SelfCareListResponse,
  SelfCarePlanResponse,
  SelfCareScheduleRule,
} from '@planner/contracts'
import { selfCareCompletionSchema } from '@planner/contracts'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  SelfCareHistoryTab,
  SelfCarePlanTab,
  SelfCareRitualsTab,
  SelfCareTodayTab,
} from './SelfCarePage.components'

vi.mock('@/features/session', () => ({
  usePlannerTimeZone: () => 'Asia/Novosibirsk',
}))

describe('Self-care tab states', () => {
  afterEach(() => {
    cleanup()
  })

  it.each([true, false])(
    'offers pause or resume for recurring care (active: %s)',
    (isActive) => {
      const onTogglePauseItem = vi.fn()
      const list = createRecurringList(isActive)
      render(
        <SelfCareRitualsTab
          canAddCare
          dashboardItems={[]}
          history={undefined}
          isBusy={false}
          isAddingCare={false}
          list={list}
          plan={undefined}
          ritualStepDrafts={{}}
          todayKey="2026-08-06"
          uploadedIcons={[]}
          onAddCare={vi.fn()}
          onArchiveItem={vi.fn()}
          onEditItem={vi.fn()}
          onRestartCourse={vi.fn()}
          onScheduleItem={vi.fn()}
          onTogglePauseItem={onTogglePauseItem}
        />,
      )
      const label = isActive
        ? 'Поставить на паузу: «Йога»'
        : 'Возобновить: «Йога»'
      fireEvent.click(screen.getByRole('button', { name: label }))
      expect(onTogglePauseItem).toHaveBeenCalledWith(
        expect.objectContaining({ item: list.items[0] }),
      )
      if (!isActive) {
        expect(screen.getByText('На паузе')).toBeInTheDocument()
        expect(
          screen.getByRole('button', { name: 'Запланировать' }),
        ).toBeDisabled()
        expect(
          screen.queryByText(/Следующее выполнение:/),
        ).not.toBeInTheDocument()
      }
    },
  )

  it('does not offer pause for a one-off care item and disables it while saving', () => {
    const list = createRecurringList(true)
    const props = {
      canAddCare: true,
      dashboardItems: [],
      history: undefined,
      isBusy: true,
      isAddingCare: false,
      list,
      plan: undefined,
      ritualStepDrafts: {},
      todayKey: '2026-08-06',
      uploadedIcons: [],
      onAddCare: vi.fn(),
      onArchiveItem: vi.fn(),
      onEditItem: vi.fn(),
      onRestartCourse: vi.fn(),
      onScheduleItem: vi.fn(),
      onTogglePauseItem: vi.fn(),
    }
    const { rerender } = render(<SelfCareRitualsTab {...props} />)
    const button = screen.getByRole('button', {
      name: 'Поставить на паузу: «Йога»',
    })
    expect(button).toBeDisabled()
    fireEvent.click(button)
    expect(props.onTogglePauseItem).not.toHaveBeenCalled()
    rerender(
      <SelfCareRitualsTab
        {...props}
        isBusy={false}
        list={{ ...list, scheduleRules: [] }}
      />,
    )
    expect(
      screen.queryByRole('button', { name: /Поставить на паузу/ }),
    ).not.toBeInTheDocument()
  })

  it('shows an early morning completion on the planner local date', () => {
    const completedAt = '2026-09-21T18:00:00Z'
    const completion = selfCareCompletionSchema.parse({
      id: 'completion',
      itemId: 'care',
      userId: 'user',
      completedAt,
      createdAt: completedAt,
      updatedAt: completedAt,
      alternativeTitle: null,
      completedVariant: null,
      durationMinutes: null,
      measurementUnit: null,
      measurementValue: null,
      note: '',
      occurrenceId: null,
      scheduledFor: null,
      status: 'done',
      version: 1,
    })
    const { container } = render(
      <SelfCareHistoryTab
        canAddCare
        defaultCurrency="RUB"
        history={{
          appointmentDetails: [],
          procedureDetails: [],
          items: [],
          completions: [completion],
          stepCompletions: [],
        }}
        isBusy={false}
        isAddingCare={false}
        onAddCare={vi.fn()}
        onEditCompletion={vi.fn()}
      />,
    )
    expect(container.querySelector('time')).toHaveAttribute(
      'datetime',
      '2026-09-22',
    )
    expect(screen.getByText(/вторник, 22 сентября/)).toBeInTheDocument()
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
        onEditItem={vi.fn()}
        onTogglePauseItem={vi.fn()}
        onRestartCourse={vi.fn()}
        onScheduleItem={vi.fn()}
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
        onEditItem={vi.fn()}
        onTogglePauseItem={vi.fn()}
        onRestartCourse={vi.fn()}
        onScheduleItem={vi.fn()}
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
        onTogglePauseItem={vi.fn()}
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
        onTogglePauseItem={vi.fn()}
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

function createRecurringList(isActive: boolean): SelfCareListResponse {
  const item: SelfCareItem = {
    category: 'movement',
    color: null,
    createdAt: '2026-08-01T08:00:00Z',
    createdFromTemplateId: null,
    customCategoryId: null,
    defaultDurationMinutes: null,
    deletedAt: null,
    description: '',
    icon: '🧘',
    id: 'yoga',
    importance: 'recommended',
    isActive,
    isArchived: false,
    isPrivate: true,
    migratedFromHabitId: null,
    minimumVersionDescription: null,
    minimumVersionDurationMinutes: null,
    minimumVersionTitle: null,
    preferredTimeOfDay: 'morning',
    title: 'Йога',
    type: 'habit',
    updatedAt: '2026-08-01T08:00:00Z',
    userId: 'user',
    version: 1,
    workspaceId: 'workspace',
  }
  const rule: SelfCareScheduleRule = {
    allowMultiplePerDay: false,
    createdAt: item.createdAt,
    dayOfMonth: null,
    daysOfWeek: [],
    endDate: null,
    flexiblePeriod: null,
    flexibleTargetCount: null,
    generateInCalendar: true,
    generateInTaskList: true,
    id: 'yoga-rule',
    intervalUnit: null,
    intervalValue: null,
    itemId: item.id,
    monthOfYear: null,
    preferredTime: null,
    reminderOffsetsMinutes: [],
    repeatKind: 'daily',
    startDate: '2026-08-01',
    timezone: 'Asia/Novosibirsk',
    updatedAt: item.updatedAt,
    weekOfMonth: null,
  }
  return { ...createEmptyList(), items: [item], scheduleRules: [rule] }
}
