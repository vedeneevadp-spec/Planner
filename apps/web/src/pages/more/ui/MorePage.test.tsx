import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { ThemeProvider } from '@/shared/lib/theme'

import { MorePage } from './MorePage'

type AppRole = 'admin' | 'guest' | 'owner' | 'test' | 'user'

interface MoreSessionStub {
  actor: {
    avatarUrl: string | null
    displayName: string
    email: string
    id: string
  }
  actorUserId: string
  appRole: AppRole
  role: 'owner'
  workspace: {
    id: string
    kind: 'personal'
    name: string
  }
  workspaceId: string
  workspaces: Array<{
    id: string
    kind: 'personal'
    name: string
  }>
}

interface PlannerStub {
  conflictedMutationCount: number
  debugErrorDetails: string | null
  errorMessage: string | null
  isLoading: boolean
  isSyncing: boolean
  queuedMutationCount: number
  readiness: {
    canReadCachedData: boolean
    canRenderAppContent: boolean
    canUseProtectedApi: boolean
    canWriteProtectedData: boolean
    reason: string
    status: string
  }
  refresh: () => void
}

interface SessionAuthStub {
  accessToken: string | null
  canUseProtectedApi: boolean
  email: string | null
  isAuthEnabled: boolean
  signOut: () => Promise<void>
}

const mocks = vi.hoisted(() => ({
  createSharedWorkspace: {
    isPending: false,
    mutateAsync: vi.fn(() => Promise.resolve(undefined)),
    reset: vi.fn(),
  },
  downloadUserBackup: vi.fn(),
  previewUserBackupImport: vi.fn(),
  saveUserBackupFile: vi.fn(),
  signOut: vi.fn<() => Promise<void>>(),
  usePlanner: vi.fn<() => PlannerStub>(),
  usePlannerSession: vi.fn<() => { data: MoreSessionStub }>(),
  useSessionAuth: vi.fn<() => SessionAuthStub>(),
}))

vi.mock('@/features/planner', () => ({
  usePlanner: () => mocks.usePlanner(),
}))

vi.mock('@/features/user-backup', () => ({
  downloadUserBackup: mocks.downloadUserBackup,
  getUserBackupErrorMessage: () => 'Не удалось обработать резервную копию.',
  parseUserBackupArchiveText: (text: string) =>
    JSON.parse(text) as Record<string, unknown>,
  previewUserBackupImport: mocks.previewUserBackupImport,
  saveUserBackupFile: mocks.saveUserBackupFile,
}))

vi.mock('@/features/session', () => ({
  getCreateSharedWorkspaceErrorMessage: () =>
    'Не удалось создать пространство.',
  getSessionReadinessConnectionView: (
    readiness: PlannerStub['readiness'],
    input: {
      featureErrorMessage?: string | null
      isFeatureLoading?: boolean
      isFeatureSyncing?: boolean
    },
  ) => {
    if (input.featureErrorMessage) {
      return {
        errorMessage: input.featureErrorMessage,
        label: 'Connection issue',
      }
    }

    if (readiness.status === 'offlineWithCache') {
      return {
        errorMessage: 'Auth session unavailable',
        label: 'Connection issue',
      }
    }

    if (input.isFeatureLoading) {
      return {
        errorMessage: null,
        label: 'Loading',
      }
    }

    if (input.isFeatureSyncing) {
      return {
        errorMessage: null,
        label: 'Syncing',
      }
    }

    return {
      errorMessage: null,
      label: 'Connected',
    }
  },
  useCreateSharedWorkspace: () => mocks.createSharedWorkspace,
  usePlannerSession: () => mocks.usePlannerSession(),
  UserAvatar: ({ displayName }: { displayName: string }) => (
    <span>{displayName.slice(0, 2)}</span>
  ),
  useSessionAuth: () => mocks.useSessionAuth(),
}))

function renderMorePage(
  options: {
    appRole?: AppRole
    auth?: Partial<SessionAuthStub>
    planner?: Partial<PlannerStub>
  } = {},
) {
  const session: MoreSessionStub = {
    actor: {
      avatarUrl: null,
      displayName: 'Tikondra',
      email: 'vedeneeva.d.p@gmail.com',
      id: 'actor-1',
    },
    actorUserId: 'actor-1',
    appRole: options.appRole ?? 'owner',
    role: 'owner',
    workspace: {
      id: 'personal-workspace',
      kind: 'personal',
      name: 'Personal Workspace',
    },
    workspaceId: 'personal-workspace',
    workspaces: [
      {
        id: 'personal-workspace',
        kind: 'personal',
        name: 'Personal Workspace',
      },
    ],
  }

  mocks.usePlannerSession.mockReturnValue({ data: session })
  mocks.usePlanner.mockReturnValue({
    conflictedMutationCount: 0,
    debugErrorDetails: null,
    errorMessage: null,
    isLoading: false,
    isSyncing: false,
    queuedMutationCount: 0,
    readiness: {
      canReadCachedData: true,
      canRenderAppContent: true,
      canUseProtectedApi: false,
      canWriteProtectedData: false,
      reason: 'auth_deferred',
      status: 'offlineWithCache',
    },
    refresh: vi.fn(),
    ...options.planner,
  })
  mocks.useSessionAuth.mockReturnValue({
    accessToken: null,
    canUseProtectedApi: false,
    email: 'vedeneeva.d.p@gmail.com',
    isAuthEnabled: true,
    signOut: mocks.signOut,
    ...options.auth,
  })

  return render(
    <ThemeProvider>
      <MemoryRouter>
        <MorePage />
      </MemoryRouter>
    </ThemeProvider>,
  )
}

describe('MorePage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.downloadUserBackup.mockResolvedValue({
      fileName: 'planner-backup.json',
      text: '{"format":"planner.user-backup"}',
    })
    mocks.previewUserBackupImport.mockResolvedValue({
      archive: {
        exportedAt: '2026-07-09T09:50:22.414Z',
        format: 'planner.user-backup',
        sourceAppVersion: '1.0.0',
        version: 1,
        workspaceId: 'personal-workspace',
        workspaceKind: 'personal',
        workspaceName: 'Personal Workspace',
      },
      assets: {
        count: 0,
        totalBytes: 0,
      },
      canRestore: true,
      tables: [],
      warnings: [],
    })
    mocks.saveUserBackupFile.mockResolvedValue({
      destination: 'android-downloads',
      displayPath: 'Загрузки/Chaotika/planner-backup.json',
      fileName: 'planner-backup.json',
    })
  })

  afterEach(() => {
    cleanup()
  })

  it('shows retry for readiness connection issues without a planner feature error', () => {
    const refresh = vi.fn()

    renderMorePage({
      planner: {
        refresh,
      },
    })

    expect(screen.getByText('Auth session unavailable')).toBeVisible()

    fireEvent.click(
      screen.getByRole('button', { name: 'Повторить синхронизацию' }),
    )

    expect(refresh).toHaveBeenCalledTimes(1)
  })

  it('shows connection debug details only to the global owner', () => {
    renderMorePage({
      planner: {
        conflictedMutationCount: 1,
        debugErrorDetails: '[tasksQuery.error]\nname=TypeError',
        queuedMutationCount: 2,
      },
    })

    expect(screen.getByText('Детали ошибки')).toBeVisible()
    expect(
      screen.getByText(/readiness\.status=offlineWithCache/),
    ).toBeInTheDocument()
    expect(screen.getByText(/queuedMutations=2/)).toBeInTheDocument()
    expect(screen.getByText(/\[tasksQuery\.error\]/)).toBeInTheDocument()
  })

  it('hides connection debug details from non-owner admins', () => {
    renderMorePage({
      appRole: 'admin',
      planner: {
        debugErrorDetails: '[tasksQuery.error]\nmessage=secret details',
      },
    })

    expect(screen.queryByText('Детали ошибки')).not.toBeInTheDocument()
    expect(screen.queryByText(/secret details/)).not.toBeInTheDocument()
  })

  it('shows voice assistant as a settings link after the theme control', () => {
    renderMorePage({
      planner: {
        readiness: {
          canReadCachedData: true,
          canRenderAppContent: true,
          canUseProtectedApi: true,
          canWriteProtectedData: true,
          reason: 'ready',
          status: 'ready',
        },
      },
    })

    const settings = screen.getByRole('region', { name: 'Настройки' })
    const controls = Array.from(settings.querySelectorAll('button, a'))

    expect(
      within(settings).getByRole('link', { name: 'Голосовой помощник' }),
    ).toHaveAttribute('href', '/voice-assistant/settings')
    expect(controls.map((control) => control.textContent?.trim())).toEqual([
      expect.stringMatching(/тема/i),
      'Голосовой помощник',
    ])
  })

  it('shows contacts as a section link', () => {
    renderMorePage()

    const sections = screen.getByRole('region', { name: 'Разделы' })

    expect(
      within(sections).getByRole('link', { name: 'Контакты' }),
    ).toHaveAttribute('href', '/contacts')
  })

  it('shows backup progress and saves the archive through the platform helper', async () => {
    let resolveDownload!: (value: { fileName: string; text: string }) => void

    mocks.downloadUserBackup.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveDownload = resolve
        }),
    )

    renderMorePage({
      auth: {
        accessToken: 'access-token',
        canUseProtectedApi: true,
      },
      planner: {
        readiness: {
          canReadCachedData: true,
          canRenderAppContent: true,
          canUseProtectedApi: true,
          canWriteProtectedData: true,
          reason: 'ready',
          status: 'ready',
        },
      },
    })

    fireEvent.click(screen.getByRole('button', { name: 'Скачать копию' }))

    expect(screen.getByText('Готовим архив...')).toBeVisible()
    expect(screen.getByRole('progressbar')).toBeInTheDocument()

    resolveDownload?.({
      fileName: 'planner-backup.json',
      text: '{"format":"planner.user-backup"}',
    })

    await waitFor(() => {
      expect(mocks.saveUserBackupFile).toHaveBeenCalledWith({
        fileName: 'planner-backup.json',
        text: '{"format":"planner.user-backup"}',
      })
    })
    expect(
      await screen.findByText(
        'Резервная копия сохранена: Загрузки/Chaotika/planner-backup.json.',
      ),
    ).toBeVisible()
  })

  it('uses a broad file picker filter for mobile backup archive selection', () => {
    renderMorePage({
      auth: {
        accessToken: 'access-token',
        canUseProtectedApi: true,
      },
    })

    expect(screen.getByLabelText('Файл резервной копии')).toHaveAttribute(
      'accept',
      expect.stringContaining('*/*'),
    )

    fireEvent.click(screen.getByRole('button', { name: 'Проверить файл' }))

    expect(screen.getByText(/Открылся выбор файла/)).toBeVisible()
  })
})
