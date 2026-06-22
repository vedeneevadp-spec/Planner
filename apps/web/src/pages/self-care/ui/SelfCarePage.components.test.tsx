import type {
  SelfCareDashboardResponse,
  SelfCareHistoryResponse,
  SelfCareListResponse,
  SelfCareTodayItem,
} from '@planner/contracts'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { SelfCareTodayTab } from './SelfCarePage.components'

const TODAY_KEY = '2026-06-22'

afterEach(() => {
  cleanup()
})

describe('SelfCareTodayTab', () => {
  it('lets overdue occurrences be skipped', () => {
    const overdueEntry = createSelfCareTodayItem()
    const onSkipOccurrence = vi.fn()

    render(
      <SelfCareTodayTab
        dashboard={createDashboard({ overdueItems: [overdueEntry] })}
        history={createHistory()}
        hiddenScheduledItemIds={new Set()}
        isBusy={false}
        list={createList()}
        plan={undefined}
        ritualStepDrafts={{}}
        todayKey={TODAY_KEY}
        uploadedIcons={[]}
        onAddCare={vi.fn()}
        onCardAction={vi.fn()}
        onArchiveItem={vi.fn()}
        onEditItem={vi.fn()}
        onRestartCourse={vi.fn()}
        onScheduleItem={vi.fn()}
        onShowHistory={vi.fn()}
        onShowPlan={vi.fn()}
        onSkipOccurrence={onSkipOccurrence}
        onToggleRitualStep={vi.fn()}
      />,
    )

    const completeButton = screen.getByRole('button', {
      name: 'Выполнить: «Утренний кофе»',
    })
    const editButton = screen.getByRole('button', {
      name: 'Настроить заботу «Утренний кофе»',
    })
    const archiveButton = screen.getByRole('button', {
      name: 'Удалить заботу «Утренний кофе»',
    })
    const skipButton = screen.getByRole('button', { name: 'Пропустить' })
    const scheduleButton = screen.getByRole('button', { name: 'Перенести' })

    expect(appearsBefore(completeButton, skipButton)).toBe(true)
    expect(appearsBefore(editButton, skipButton)).toBe(true)
    expect(appearsBefore(archiveButton, skipButton)).toBe(true)
    expect(appearsBefore(skipButton, scheduleButton)).toBe(true)

    fireEvent.click(skipButton)

    expect(onSkipOccurrence).toHaveBeenCalledWith(overdueEntry)
  })

  it('does not show skip action for today occurrences', () => {
    const todayEntry = createSelfCareTodayItem()
    if (todayEntry.occurrence) {
      todayEntry.occurrence.scheduledFor = TODAY_KEY
    }

    render(
      <SelfCareTodayTab
        dashboard={createDashboard({ todayItems: [todayEntry] })}
        history={createHistory()}
        hiddenScheduledItemIds={new Set()}
        isBusy={false}
        list={createList()}
        plan={undefined}
        ritualStepDrafts={{}}
        todayKey={TODAY_KEY}
        uploadedIcons={[]}
        onAddCare={vi.fn()}
        onCardAction={vi.fn()}
        onArchiveItem={vi.fn()}
        onEditItem={vi.fn()}
        onRestartCourse={vi.fn()}
        onScheduleItem={vi.fn()}
        onShowHistory={vi.fn()}
        onShowPlan={vi.fn()}
        onSkipOccurrence={vi.fn()}
        onToggleRitualStep={vi.fn()}
      />,
    )

    expect(screen.queryByRole('button', { name: 'Пропустить' })).toBeNull()
  })
})

function createSelfCareTodayItem(): SelfCareTodayItem {
  return {
    appointment: null,
    completion: null,
    courseDetails: null,
    flexibleProgress: null,
    item: {
      category: 'relax',
      color: null,
      createdAt: '2026-06-01T08:00:00.000Z',
      createdFromTemplateId: null,
      customCategoryId: null,
      defaultDurationMinutes: null,
      deletedAt: null,
      description: '',
      icon: null,
      id: 'self-care-1',
      importance: 'recommended',
      isActive: true,
      isArchived: false,
      isPrivate: true,
      migratedFromHabitId: null,
      minimumVersionDescription: null,
      minimumVersionDurationMinutes: null,
      minimumVersionTitle: null,
      preferredTimeOfDay: 'morning',
      title: 'Утренний кофе',
      type: 'task',
      updatedAt: '2026-06-01T08:00:00.000Z',
      userId: 'user-1',
      version: 1,
      workspaceId: 'workspace-1',
    },
    lastMeasurement: null,
    measurement: null,
    occurrence: {
      completedAt: null,
      createdAt: '2026-06-20T08:00:00.000Z',
      dueAt: null,
      generatedAt: null,
      id: 'occurrence-1',
      itemId: 'self-care-1',
      movedTo: null,
      scheduledFor: '2026-06-20',
      scheduleRuleId: null,
      status: 'scheduled',
      updatedAt: '2026-06-20T08:00:00.000Z',
      userId: 'user-1',
    },
    procedure: null,
    scheduleRule: null,
    steps: [],
    timeGroup: 'morning',
  }
}

function createDashboard(
  input: {
    overdueItems?: SelfCareTodayItem[]
    todayItems?: SelfCareTodayItem[]
  } = {},
): SelfCareDashboardResponse {
  return {
    date: TODAY_KEY,
    dailyState: null,
    flexibleGoals: [],
    gentleMode: false,
    minimumItems: [],
    overdueItems: input.overdueItems ?? [],
    planningHints: [],
    settings: {
      currency: 'RUB',
      createdAt: '2026-06-01T08:00:00.000Z',
      defaultReminderTone: 'soft',
      gentleModeDate: null,
      gentleModeEnabledToday: false,
      id: 'settings-1',
      quietHoursEnd: null,
      quietHoursStart: null,
      showAppointmentsInCalendar: true,
      showSelfCareInMainTasks: true,
      updatedAt: '2026-06-01T08:00:00.000Z',
      userId: 'user-1',
    },
    todayItems: input.todayItems ?? [],
    upcomingImportant: [],
  }
}

function appearsBefore(left: HTMLElement, right: HTMLElement): boolean {
  return Boolean(
    left.compareDocumentPosition(right) & Node.DOCUMENT_POSITION_FOLLOWING,
  )
}

function createHistory(): SelfCareHistoryResponse {
  return {
    completions: [],
    items: [],
    stepCompletions: [],
  }
}

function createList(): SelfCareListResponse {
  return {
    alternatives: [],
    appointmentDetails: [],
    courseDetails: [],
    items: [],
    medicalDetails: [],
    measurementDetails: [],
    procedureDetails: [],
    scheduleRules: [],
    steps: [],
  }
}
