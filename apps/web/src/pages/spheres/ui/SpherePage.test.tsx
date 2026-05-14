import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { SpherePage } from './SpherePage'

const removeSphere = vi.fn<(sphereId: string) => Promise<boolean>>()

vi.mock('@/features/emoji-library', () => ({
  useUploadedIconAssets: () => ({
    uploadedIcons: [],
  }),
}))

vi.mock('@/features/planner', () => ({
  usePlanner: () => ({
    isLoading: false,
    isTaskPending: () => false,
    spheres: [
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
  useWorkspaceUsers: () => ({
    data: {
      users: [],
    },
  }),
}))

describe('SpherePage', () => {
  beforeEach(() => {
    removeSphere.mockReset()
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
})
