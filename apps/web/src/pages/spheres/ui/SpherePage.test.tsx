import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { SpherePage } from './SpherePage'

const removeSphere = vi.fn<(sphereId: string) => Promise<boolean>>()
const refresh = vi.fn()
const readState = {
  hasLifeSphereRecords: true,
  hasLifeSphereReadError: false,
  hasTaskRecords: true,
  hasTaskReadError: false,
  isLifeSphereCacheHydrating: false,
  isLifeSphereOffline: false,
  isTaskCacheHydrating: false,
  isTaskOffline: false,
  missingSphere: false,
}

vi.mock('@/features/emoji-library', () => ({
  useUploadedIconAssets: () => ({
    uploadedIcons: [],
  }),
}))

vi.mock('@/features/planner', () => ({
  usePlanner: () => ({
    ...readState,
    readiness: { reason: 'ready' },
    refresh,
    isLoading: false,
    isTaskPending: () => false,
    spheres: readState.missingSphere
      ? []
      : [
          {
            color: '#214e42',
            createdAt: '2026-05-12T00:00:00.000Z',
            deletedAt: null,
            description: 'Описание',
            icon: 'folder',
            id: 'sphere-1',
            isActive: true,
            isDefault: false,
            name: 'Здоровье',
            sortOrder: 0,
            updatedAt: '2026-05-12T00:00:00.000Z',
            userId: 'user-1',
            version: 1,
            workspaceId: 'workspace-1',
          },
        ],
    removeSphere,
    removeTask: vi.fn(),
    setTaskPlannedDate: vi.fn(),
    setTaskStatus: vi.fn(),
    tasks: [],
    updateSphere: vi.fn(),
    updateTask: vi.fn(),
  }),
}))

vi.mock('@/features/session', () => ({
  usePlannerSession: () => ({
    data: {
      workspace: {
        kind: 'personal',
      },
    },
  }),
  usePlannerTimeZone: () => 'Europe/Astrakhan',
  useWorkspaceUsers: () => ({
    data: {
      users: [],
    },
  }),
}))

describe('SpherePage', () => {
  beforeEach(() => {
    removeSphere.mockReset()
    refresh.mockReset()
    Object.assign(readState, {
      hasLifeSphereRecords: true,
      hasLifeSphereReadError: false,
      hasTaskRecords: true,
      hasTaskReadError: false,
      isLifeSphereCacheHydrating: false,
      isLifeSphereOffline: false,
      isTaskCacheHydrating: false,
      isTaskOffline: false,
      missingSphere: false,
    })
    removeSphere.mockResolvedValue(true)
    vi.spyOn(window, 'confirm').mockReturnValue(true)
  })

  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
  })

  it('deletes a sphere and returns to the sphere list', async () => {
    render(
      <MemoryRouter initialEntries={['/spheres/sphere-1']}>
        <Routes>
          <Route path="/spheres/:sphereId" element={<SpherePage />} />
          <Route path="/spheres" element={<div>Список сфер</div>} />
        </Routes>
      </MemoryRouter>,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Удалить' }))

    await waitFor(() => {
      expect(removeSphere).toHaveBeenCalledWith('sphere-1')
    })
    expect(await screen.findByText('Список сфер')).toBeVisible()
  })

  it('shows a retryable read error instead of claiming the sphere does not exist', () => {
    Object.assign(readState, {
      missingSphere: true,
      hasLifeSphereRecords: false,
      hasLifeSphereReadError: true,
    })
    renderSpherePage()
    expect(screen.getByText('Не удалось загрузить сферу')).toBeVisible()
    expect(screen.queryByText('Сфера не найдена')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Повторить' }))
    expect(refresh).toHaveBeenCalledWith({ retryDeniedAuth: false })
  })

  it('reports not found only after the sphere list has loaded', () => {
    readState.missingSphere = true
    renderSpherePage()
    expect(screen.getByText('Сфера не найдена')).toBeVisible()
  })

  it('keeps cached sphere details visible during a failed refresh', () => {
    readState.hasLifeSphereReadError = true
    renderSpherePage()
    expect(
      screen.getByRole('heading', { level: 2, name: 'Здоровье' }),
    ).toBeVisible()
    expect(screen.getByText('Не удалось обновить данные')).toBeVisible()
  })

  it('does not report an empty task list when tasks failed to load', () => {
    readState.hasTaskRecords = false
    readState.hasTaskReadError = true
    renderSpherePage()
    expect(screen.getByText('Не удалось загрузить задачи сферы')).toBeVisible()
    expect(
      screen.queryByText('В этой сфере пока нет задач.'),
    ).not.toBeInTheDocument()
  })
})

function renderSpherePage() {
  return render(
    <MemoryRouter initialEntries={['/spheres/sphere-1']}>
      <Routes>
        <Route path="/spheres/:sphereId" element={<SpherePage />} />
      </Routes>
    </MemoryRouter>,
  )
}
