import type {
  SelfCareDashboardResponse,
  SelfCareHistoryResponse,
  SelfCareListResponse,
  SelfCareTodayItem,
} from '@planner/contracts'
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { SelfCareTodayTab } from './SelfCarePage.components'

const TODAY_KEY = '2026-06-22'

describe('SelfCareTodayTab', () => {
  it('lets overdue occurrences be skipped', () => {
    const overdueEntry = createSelfCareTodayItem()
    const onSkipOccurrence = vi.fn()

    render(
      <SelfCareTodayTab
        dashboard={createDashboard([overdueEntry])}
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

    fireEvent.click(screen.getByRole('button', { name: 'Пропустить' }))

    expect(onSkipOccurrence).toHaveBeenCalledWith(overdueEntry)
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
  overdueItems: SelfCareTodayItem[],
): SelfCareDashboardResponse {
  return {
    date: TODAY_KEY,
    dailyState: null,
    flexibleGoals: [],
    gentleMode: false,
    minimumItems: [],
    overdueItems,
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
    todayItems: [],
    upcomingImportant: [],
  }
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
