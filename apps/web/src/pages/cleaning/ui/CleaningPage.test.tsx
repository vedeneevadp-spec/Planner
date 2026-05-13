import type {
  CleaningListResponse,
  CleaningZoneRecord,
} from '@planner/contracts'
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { CleaningPage, CleaningSettingsPage } from './CleaningPage'

const mocks = vi.hoisted(() => ({
  createTask: vi.fn<(input: unknown) => Promise<unknown>>(),
  createZone: vi.fn<(input: unknown) => Promise<unknown>>(),
  removeTask: vi.fn<(input: unknown) => Promise<unknown>>(),
  removeZone: vi.fn<(input: unknown) => Promise<unknown>>(),
  updateTask: vi.fn<(input: unknown) => Promise<unknown>>(),
  updateZone: vi.fn<(input: unknown) => Promise<unknown>>(),
  useCleaningPlan: vi.fn<
    () => {
      data: CleaningListResponse
      error: null
      isLoading: boolean
    }
  >(),
}))

vi.mock('@/features/cleaning', () => {
  function createMutationStub(
    mutateAsync: (input: unknown) => Promise<unknown>,
  ) {
    return {
      error: null,
      isPending: false,
      mutateAsync,
    }
  }

  function createNoopMutationStub() {
    return createMutationStub(vi.fn(() => Promise.resolve(undefined)))
  }

  return {
    getCleaningErrorMessage: (error: unknown) =>
      error instanceof Error ? error.message : 'Не удалось сохранить уборку.',
    useCleaningPlan: () => mocks.useCleaningPlan(),
    useCleaningToday: () => ({
      data: null,
      error: null,
      isLoading: false,
    }),
    useCompleteCleaningTask: createNoopMutationStub,
    useCreateCleaningTask: () => createMutationStub(mocks.createTask),
    useCreateCleaningZone: () => createMutationStub(mocks.createZone),
    usePostponeCleaningTask: createNoopMutationStub,
    useRemoveCleaningTask: () => createMutationStub(mocks.removeTask),
    useRemoveCleaningZone: () => createMutationStub(mocks.removeZone),
    useSkipCleaningTask: createNoopMutationStub,
    useUpdateCleaningTask: () => createMutationStub(mocks.updateTask),
    useUpdateCleaningZone: () => createMutationStub(mocks.updateZone),
  }
})

function createZone(): CleaningZoneRecord {
  return {
    createdAt: '2026-05-12T00:00:00.000Z',
    dayOfWeek: 4,
    deletedAt: null,
    description: 'Игрушки, одежда, рабочее место и вещи',
    id: 'zone-1',
    isActive: true,
    sortOrder: 0,
    title: 'Комната Кирилла',
    updatedAt: '2026-05-12T00:00:00.000Z',
    userId: 'user-1',
    version: 1,
    workspaceId: 'workspace-1',
  }
}

function createPlan(zone = createZone()): CleaningListResponse {
  return {
    history: [],
    states: [],
    tasks: [],
    zones: [zone],
  }
}

function createEmptyPlan(): CleaningListResponse {
  return {
    history: [],
    states: [],
    tasks: [],
    zones: [],
  }
}

function renderCleaningSettingsPage() {
  return render(
    <MemoryRouter initialEntries={['/cleaning/settings/zones/zone-1']}>
      <Routes>
        <Route
          path="/cleaning/settings/zones/:zoneId"
          element={<CleaningSettingsPage />}
        />
      </Routes>
    </MemoryRouter>,
  )
}

function renderCleaningPage() {
  return render(
    <MemoryRouter initialEntries={['/cleaning']}>
      <CleaningPage />
    </MemoryRouter>,
  )
}

describe('CleaningSettingsPage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.createTask.mockResolvedValue(undefined)
    mocks.createZone.mockResolvedValue(createZone())
    mocks.removeTask.mockResolvedValue(undefined)
    mocks.removeZone.mockResolvedValue(undefined)
    mocks.updateTask.mockResolvedValue(undefined)
    mocks.updateZone.mockResolvedValue(createZone())
    mocks.useCleaningPlan.mockReturnValue({
      data: createPlan(),
      error: null,
      isLoading: false,
    })
  })

  afterEach(() => {
    cleanup()
  })

  it('closes zone editing after saving zone settings', async () => {
    renderCleaningSettingsPage()

    fireEvent.click(screen.getByRole('button', { name: 'Редактировать зону' }))
    fireEvent.click(screen.getByRole('button', { name: 'Сохранить зону' }))

    await waitFor(() => {
      expect(mocks.updateZone).toHaveBeenCalledWith({
        input: {
          dayOfWeek: 4,
          description: 'Игрушки, одежда, рабочее место и вещи',
          title: 'Комната Кирилла',
        },
        zoneId: 'zone-1',
      })
    })

    await waitFor(() => {
      expect(
        screen.queryByRole('button', { name: 'Сохранить зону' }),
      ).not.toBeInTheDocument()
    })
  })
})

describe('CleaningPage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.createTask.mockResolvedValue(undefined)
    mocks.createZone.mockResolvedValue(createZone())
    mocks.useCleaningPlan.mockReturnValue({
      data: createEmptyPlan(),
      error: null,
      isLoading: false,
    })
  })

  afterEach(() => {
    cleanup()
  })

  it('keeps the empty cleaning seed action inside the empty state card', () => {
    renderCleaningPage()

    expect(
      screen.queryByRole('button', { name: 'Добавить шаблоны' }),
    ).not.toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: 'Добавить базовый набор' }),
    ).toBeVisible()
  })
})
