import type {
  SelfCareDashboardResponse,
  SelfCareTodayItem,
} from '@planner/contracts'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { Task } from '@/entities/task'
import { addDays, getDateKey } from '@/shared/lib/date'

import { TodayPage } from './TodayPage'

type WorkspaceKind = 'personal' | 'shared'

interface PlannerSessionStub {
  actorUserId: string
  groupRole: null
  role: 'owner'
  userPreferences: {
    energyMode: 'normal'
    voiceAssistantEnabled: true
  }
  workspace: {
    id: string
    kind: WorkspaceKind
    name: string
  }
}

const mocks = vi.hoisted(() => ({
  copyTaskToPersonal: vi.fn(),
  moveTaskToPersonal: vi.fn(),
  removeTask: vi.fn(),
  selfCareDashboard: undefined as SelfCareDashboardResponse | undefined,
  setTaskPlannedDate: vi.fn(),
  setTaskStatus: vi.fn(),
  updateTask: vi.fn(),
  updateUserPreferences: vi.fn(),
  usePlannerSession: vi.fn<() => { data: PlannerSessionStub }>(),
}))

vi.mock('@/features/emoji-library', () => ({
  useUploadedIconAssets: () => ({ uploadedIcons: [] }),
}))

vi.mock('@/features/planner', () => ({
  usePlanner: () => ({
    copyTaskToPersonal: mocks.copyTaskToPersonal,
    isTaskPending: () => false,
    moveTaskToPersonal: mocks.moveTaskToPersonal,
    removeTask: mocks.removeTask,
    setTaskPlannedDate: mocks.setTaskPlannedDate,
    setTaskStatus: mocks.setTaskStatus,
    spheres: [],
    tasks: plannerTasks,
    updateTask: mocks.updateTask,
  }),
}))

vi.mock('@/features/self-care', () => ({
  useSelfCareDashboard: () => ({ data: mocks.selfCareDashboard }),
}))

vi.mock('@/features/session', () => ({
  usePlannerSession: () => mocks.usePlannerSession(),
  useUpdateUserPreferences: () => ({
    mutate: mocks.updateUserPreferences,
  }),
  useWorkspaceUsers: () => ({ data: { users: [] } }),
}))

vi.mock('@/features/task-create', () => ({
  TaskComposer: () => null,
}))

vi.mock('./ResourcePlanPanel', () => ({
  ResourcePlanPanel: () => null,
}))

let plannerTasks: Task[] = []

function createSession(kind: WorkspaceKind): PlannerSessionStub {
  return {
    actorUserId: 'user-1',
    groupRole: null,
    role: 'owner',
    userPreferences: {
      energyMode: 'normal',
      voiceAssistantEnabled: true,
    },
    workspace: {
      id: `${kind}-workspace`,
      kind,
      name: kind === 'shared' ? 'Shared workspace' : 'Personal workspace',
    },
  }
}

function createTask(overrides: Partial<Task> = {}): Task {
  return {
    assigneeDisplayName: null,
    assigneeUserId: null,
    authorDisplayName: null,
    authorUserId: null,
    completedAt: null,
    createdAt: '2026-05-19T08:00:00.000Z',
    dueDate: null,
    icon: '',
    id: 'task-1',
    importance: 'not_important',
    note: '',
    plannedDate: null,
    plannedEndTime: null,
    plannedStartTime: null,
    project: '',
    projectId: null,
    requiresConfirmation: false,
    resource: null,
    sphereId: null,
    status: 'todo',
    title: 'Неразложенная задача',
    urgency: 'not_urgent',
    ...overrides,
  }
}

function createRoutineTask(overrides: Partial<Task> = {}): Task {
  return createTask({
    routine: {
      daysOfWeek: [1, 2, 3, 4, 5, 6, 7],
      frequency: 'daily',
      seriesId: 'routine-series-1',
      targetType: 'check',
      targetValue: 1,
      unit: '',
    },
    ...overrides,
  })
}

type SelfCareTodayItemOverrides = Omit<Partial<SelfCareTodayItem>, 'item'> & {
  item?: Partial<SelfCareTodayItem['item']>
}

function createSelfCareTodayItem(
  overrides: SelfCareTodayItemOverrides = {},
): SelfCareTodayItem {
  const { item: itemOverrides, ...entryOverrides } = overrides

  return {
    appointment: null,
    completion: null,
    courseDetails: null,
    flexibleProgress: null,
    item: {
      category: 'daily_base',
      color: null,
      createdAt: '2026-05-19T08:00:00.000Z',
      customCategoryId: null,
      defaultDurationMinutes: null,
      deletedAt: null,
      description: '',
      icon: 'image:legacy-icon',
      id: 'self-care-1',
      importance: 'recommended',
      isActive: true,
      isArchived: false,
      isPrivate: true,
      migratedFromHabitId: 'habit-1',
      preferredTimeOfDay: 'anytime',
      title: 'Компактная привычка',
      type: 'habit',
      updatedAt: '2026-05-19T08:00:00.000Z',
      userId: 'user-1',
      version: 1,
      workspaceId: 'personal-workspace',
      ...itemOverrides,
    } as SelfCareTodayItem['item'],
    lastMeasurement: null,
    measurement: null,
    occurrence: null,
    procedure: null,
    scheduleRule: null,
    steps: [],
    timeGroup: 'anytime',
    ...entryOverrides,
  }
}

function createSelfCareDashboard(
  todayItems: SelfCareTodayItem[],
  options: { flexibleGoals?: SelfCareTodayItem[] } = {},
): SelfCareDashboardResponse {
  return {
    date: getDateKey(new Date()),
    dailyState: null,
    flexibleGoals: options.flexibleGoals ?? [],
    gentleMode: false,
    minimumItems: [],
    overdueItems: [],
    planningHints: [],
    settings: {
      showSelfCareInMainTasks: true,
    } as SelfCareDashboardResponse['settings'],
    todayItems,
    upcomingImportant: [],
  } as SelfCareDashboardResponse
}

function renderTodayPage({
  initialEntry = '/today',
  kind = 'personal',
  tasks,
}: {
  initialEntry?: string
  kind?: WorkspaceKind
  tasks: Task[]
}) {
  plannerTasks = tasks
  mocks.usePlannerSession.mockReturnValue({ data: createSession(kind) })

  return render(
    <MemoryRouter initialEntries={[initialEntry]}>
      <TodayPage />
    </MemoryRouter>,
  )
}

describe('TodayPage', () => {
  beforeEach(() => {
    plannerTasks = []
    mocks.copyTaskToPersonal.mockReset()
    mocks.moveTaskToPersonal.mockReset()
    mocks.removeTask.mockReset()
    mocks.selfCareDashboard = undefined
    mocks.setTaskPlannedDate.mockReset()
    mocks.setTaskStatus.mockReset()
    mocks.updateTask.mockReset()
    mocks.updateTask.mockResolvedValue(true)
    mocks.updateUserPreferences.mockReset()
    mocks.usePlannerSession.mockReset()
  })

  afterEach(() => {
    cleanup()
  })

  it('keeps today, routine and attention sections expanded by default', () => {
    const todayKey = getDateKey(new Date())
    const yesterdayKey = getDateKey(addDays(new Date(), -1))

    renderTodayPage({
      tasks: [
        createTask({
          id: 'today-task',
          plannedDate: todayKey,
          title: 'Задача на сегодня',
        }),
        createRoutineTask({
          id: 'routine-task',
          plannedDate: todayKey,
          title: 'Рутинная задача',
        }),
        createTask({
          id: 'overdue-task',
          plannedDate: yesterdayKey,
          title: 'Просроченная задача',
        }),
      ],
    })

    expect(screen.getByRole('button', { name: 'Сегодня' })).toHaveAttribute(
      'aria-expanded',
      'true',
    )
    expect(screen.getByRole('button', { name: 'Рутина' })).toHaveAttribute(
      'aria-expanded',
      'true',
    )
    expect(
      screen.getByRole('button', { name: 'Требуют внимания' }),
    ).toHaveAttribute('aria-expanded', 'true')
  })

  it('keeps other tasks expanded when no earlier task section is visible', () => {
    renderTodayPage({
      tasks: [createTask()],
    })

    expect(screen.queryByRole('button', { name: 'Завтра' })).toBeNull()
    expect(
      screen.getByRole('button', { name: 'Остальные задачи' }),
    ).toHaveAttribute('aria-expanded', 'true')
  })

  it('starts other tasks collapsed when today is visible and tomorrow is empty', () => {
    const todayKey = getDateKey(new Date())

    renderTodayPage({
      tasks: [
        createTask({
          id: 'today-task',
          plannedDate: todayKey,
          title: 'Задача на сегодня',
        }),
        createTask({
          id: 'other-task',
          title: 'Неразложенная задача',
        }),
      ],
    })

    expect(screen.queryByRole('button', { name: 'Завтра' })).toBeNull()
    expect(screen.getByRole('button', { name: 'Сегодня' })).toHaveAttribute(
      'aria-expanded',
      'true',
    )
    expect(
      screen.getByRole('button', { name: 'Остальные задачи' }),
    ).toHaveAttribute('aria-expanded', 'false')
  })

  it('starts other tasks collapsed when tomorrow is visible before it', () => {
    const tomorrowKey = getDateKey(addDays(new Date(), 1))

    renderTodayPage({
      tasks: [
        createTask({ id: 'task-1' }),
        createTask({
          id: 'task-2',
          plannedDate: tomorrowKey,
          title: 'Задача на завтра',
        }),
      ],
    })

    expect(screen.getByRole('button', { name: 'Завтра' })).toHaveAttribute(
      'aria-expanded',
      'true',
    )
    expect(
      screen.getByRole('button', { name: 'Остальные задачи' }),
    ).toHaveAttribute('aria-expanded', 'false')
  })

  it('keeps completed today expanded when no earlier task section is visible', () => {
    const todayKey = getDateKey(new Date())

    renderTodayPage({
      tasks: [
        createTask({
          completedAt: `${todayKey}T12:00:00.000`,
          id: 'done-task',
          status: 'done',
          title: 'Закрытая задача',
        }),
      ],
    })

    expect(
      screen.getByRole('button', { name: 'Выполнено сегодня' }),
    ).toHaveAttribute('aria-expanded', 'true')
  })

  it('shows archived tasks only in the collapsed archive section', () => {
    renderTodayPage({
      tasks: [
        createTask({
          id: 'archived-task',
          status: 'archived',
          title: 'Когда-нибудь разобрать',
        }),
      ],
    })

    expect(
      screen.queryByRole('button', { name: 'Остальные задачи' }),
    ).toBeNull()
    expect(screen.queryByText('Когда-нибудь разобрать')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Архив' })).toHaveAttribute(
      'aria-expanded',
      'false',
    )

    fireEvent.click(screen.getByRole('button', { name: 'Архив' }))

    expect(screen.getByText('Когда-нибудь разобрать')).toBeVisible()
  })

  it('keeps shared other tasks expanded when tomorrow is empty', () => {
    renderTodayPage({
      kind: 'shared',
      tasks: [createTask()],
    })

    expect(screen.queryByRole('button', { name: 'Завтра' })).toBeNull()
    expect(
      screen.getByRole('button', { name: 'Остальные задачи' }),
    ).toHaveAttribute('aria-expanded', 'true')
  })

  it('uses compact task cards when task view is list', () => {
    const todayKey = getDateKey(new Date())

    renderTodayPage({
      initialEntry: '/today?taskView=list',
      tasks: [
        createTask({
          id: 'today-task',
          note: 'Подробности не видны в компактном списке',
          plannedDate: todayKey,
          title: 'Компактная задача на сегодня',
        }),
      ],
    })

    expect(screen.getByText('Компактная задача на сегодня')).toBeVisible()
    expect(
      screen.queryByText('Подробности не видны в компактном списке'),
    ).not.toBeInTheDocument()
  })

  it('renders migrated self-care items from the self-care dashboard in routine', () => {
    mocks.selfCareDashboard = createSelfCareDashboard([
      createSelfCareTodayItem(),
    ])

    renderTodayPage({
      tasks: [],
    })

    expect(
      screen.getByRole('link', {
        name: 'Открыть заботу: Компактная привычка',
      }),
    ).toBeVisible()
    expect(screen.queryByText('image:legacy-icon')).not.toBeInTheDocument()
  })

  it('renders daily flexible self-care goals from the self-care dashboard in routine', () => {
    mocks.selfCareDashboard = createSelfCareDashboard([], {
      flexibleGoals: [
        createSelfCareTodayItem({
          flexibleProgress: {
            completedCount: 0,
            periodEnd: getDateKey(new Date()),
            periodStart: getDateKey(new Date()),
            remainingCount: 3,
            targetCount: 3,
          },
          item: {
            id: 'self-care-water',
            title: 'Вода',
          },
          scheduleRule: {
            allowMultiplePerDay: false,
            createdAt: '2026-05-14T08:00:00.000Z',
            dayOfMonth: null,
            daysOfWeek: [],
            endDate: null,
            flexiblePeriod: 'day',
            flexibleTargetCount: 3,
            generateInCalendar: false,
            generateInTaskList: true,
            id: 'self-care-water-rule',
            intervalUnit: null,
            intervalValue: null,
            itemId: 'self-care-water',
            monthOfYear: null,
            preferredTime: null,
            reminderOffsetsMinutes: [],
            repeatKind: 'flexible_goal',
            startDate: '2026-05-14',
            timezone: null,
            updatedAt: '2026-05-14T08:00:00.000Z',
            weekOfMonth: null,
          },
        }),
      ],
    })

    renderTodayPage({
      tasks: [],
    })

    expect(
      screen.getByRole('link', {
        name: 'Открыть заботу: Вода',
      }),
    ).toBeVisible()
  })

  it('keeps self-care dashboard items hidden when main tasks integration is disabled', () => {
    mocks.selfCareDashboard = {
      ...createSelfCareDashboard([createSelfCareTodayItem()]),
      settings: {
        showSelfCareInMainTasks: false,
      } as SelfCareDashboardResponse['settings'],
    }

    renderTodayPage({
      tasks: [],
    })

    expect(
      screen.queryByRole('link', {
        name: 'Открыть заботу: Компактная привычка',
      }),
    ).not.toBeInTheDocument()
  })

  it('keeps completed self-care courses out of the main today routine', () => {
    mocks.selfCareDashboard = createSelfCareDashboard([
      createSelfCareTodayItem({
        courseDetails: {
          breakDays: 0,
          completedCount: 1,
          courseType: 'days',
          createdAt: '2026-05-19T08:00:00.000Z',
          endDate: null,
          id: 'course-details-1',
          isCompleted: true,
          isPaused: false,
          itemId: 'self-care-course',
          repeatAfterCompletion: false,
          startDate: getDateKey(new Date()),
          totalCount: 1,
          updatedAt: '2026-05-19T08:00:00.000Z',
        },
        item: {
          id: 'self-care-course',
          migratedFromHabitId: null,
          title: 'Завершённый курс',
          type: 'course',
        },
      }),
    ])

    renderTodayPage({
      tasks: [],
    })

    expect(
      screen.queryByRole('link', {
        name: 'Открыть заботу: Завершённый курс',
      }),
    ).not.toBeInTheDocument()
  })
})
