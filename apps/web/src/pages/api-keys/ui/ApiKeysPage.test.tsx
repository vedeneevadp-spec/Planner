import type { ApiKeyRecord, CreateApiKeyInput } from '@planner/contracts'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { ApiKeysPage } from './ApiKeysPage'

const mocks = vi.hoisted(() => ({
  list: vi.fn<() => Promise<{ keys: ApiKeyRecord[] }>>(),
  create:
    vi.fn<
      (
        input: CreateApiKeyInput,
      ) => Promise<{ key: ApiKeyRecord; secret: string }>
    >(),
  revoke: vi.fn<(id: string) => Promise<void>>(),
  offline: false,
  workspaceId: '22222222-2222-4222-8222-222222222222',
}))
vi.mock('@/features/api-keys', () => ({ createApiKeyClient: () => mocks }))
vi.mock('@/features/session', () => ({
  useSessionFeatureReadiness: () => ({
    apiConfig: {
      accessToken: 'session-token',
      actorUserId: 'owner',
      workspaceId: mocks.workspaceId,
      apiBaseUrl: 'https://api.example.test',
      clientTimeZone: 'Asia/Novosibirsk',
    },
    readiness: { canWriteProtectedData: true },
    session: {
      actorUserId: 'owner',
      workspaceId: mocks.workspaceId,
      workspace: { name: 'Личное' },
      workspaces: [{ id: mocks.workspaceId, name: 'Личное' }],
    },
  }),
}))
vi.mock('@/shared/lib/offline-sync', () => ({
  useBrowserOffline: () => mocks.offline,
}))

const record: ApiKeyRecord = {
  id: '11111111-1111-4111-8111-111111111111',
  name: 'My bot',
  prefix: 'hkt_prefix00',
  workspaceId: '22222222-2222-4222-8222-222222222222',
  scopes: ['tasks:read'],
  createdAt: '2026-11-09T00:00:00Z',
  expiresAt: '2099-11-09T00:00:00Z',
  lastUsedAt: null,
  revokedAt: null,
}
const secret = 'hkt_local_test_secret_not_for_production'
function wrapper(client: QueryClient) {
  return (
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <ApiKeysPage />
      </MemoryRouter>
    </QueryClientProvider>
  )
}

describe('API key settings', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.offline = false
    mocks.workspaceId = record.workspaceId
    mocks.list.mockResolvedValue({ keys: [] })
    mocks.create.mockResolvedValue({ key: record, secret })
    mocks.revoke.mockResolvedValue()
  })
  afterEach(cleanup)

  it('creates selected permissions, shows the secret once and keeps it out of query cache', async () => {
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    })
    render(wrapper(client))
    await screen.findByText(
      'Пока нет ключей. Создайте первый для своей интеграции.',
    )
    fireEvent.change(screen.getByLabelText('Название'), {
      target: { value: 'My bot' },
    })
    fireEvent.click(screen.getByLabelText('Добавлять и изменять покупки'))
    fireEvent.click(screen.getByRole('button', { name: 'Создать ключ' }))
    await screen.findByDisplayValue(secret)
    expect(mocks.create).toHaveBeenCalledWith({
      name: 'My bot',
      scopes: ['tasks:read', 'shopping:read', 'shopping:write'],
      expiresInDays: 90,
    })
    expect(
      JSON.stringify(
        client
          .getQueryCache()
          .getAll()
          .map((query) => query.state.data),
      ),
    ).not.toContain(secret)
    fireEvent.click(screen.getByRole('button', { name: 'Ключ сохранён' }))
    expect(screen.queryByDisplayValue(secret)).not.toBeInTheDocument()
  })

  it('clears a newly created secret when switching workspaces', async () => {
    const client = new QueryClient()
    const view = render(wrapper(client))
    fireEvent.change(screen.getByLabelText('Название'), {
      target: { value: 'My bot' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Создать ключ' }))
    await screen.findByDisplayValue(secret)
    mocks.workspaceId = '33333333-3333-4333-8333-333333333333'
    view.rerender(wrapper(client))
    expect(screen.queryByDisplayValue(secret)).not.toBeInTheDocument()
  })

  it('revokes a key and disables management offline', async () => {
    mocks.list.mockResolvedValue({ keys: [record] })
    const client = new QueryClient()
    const view = render(wrapper(client))
    fireEvent.click(
      await screen.findByRole('button', { name: 'Отозвать ключ My bot' }),
    )
    await waitFor(() => expect(mocks.revoke).toHaveBeenCalledWith(record.id))
    await screen.findByText('Ключ «My bot» отозван.')
    mocks.offline = true
    view.rerender(wrapper(client))
    expect(
      screen.getByRole('button', { name: 'Отозвать ключ My bot' }),
    ).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Создать ключ' })).toBeDisabled()
  })

  it('offers a retry when key loading fails', async () => {
    mocks.list.mockRejectedValueOnce(new Error('offline'))
    render(wrapper(new QueryClient()))
    fireEvent.click(await screen.findByRole('button', { name: 'Повторить' }))
    await screen.findByText(
      'Пока нет ключей. Создайте первый для своей интеграции.',
    )
  })
})
