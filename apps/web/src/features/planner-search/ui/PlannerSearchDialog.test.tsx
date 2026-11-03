import type { PlannerSearchResponse } from '@planner/contracts'
import {
  onlineManager,
  QueryClient,
  QueryClientProvider,
} from '@tanstack/react-query'
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import PlannerSearchDialog from './PlannerSearchDialog'

const mocks = vi.hoisted(() => ({ search: vi.fn(), shared: false }))
vi.mock('../lib/search-api', () => ({ searchPlanner: mocks.search }))
vi.mock('@/features/session', () => ({
  usePlannerSession: () => ({
    data: {
      workspaceId: 'w1',
      workspace: { kind: mocks.shared ? 'shared' : 'personal', name: 'Личное' },
    },
  }),
  useSessionFeatureReadiness: () => ({ apiConfig: { workspaceId: 'w1' } }),
  useSessionAuth: () => ({ sessionVersion: 1 }),
}))

const found: PlannerSearchResponse = {
  page: 1,
  hasMore: false,
  unavailableSources: [],
  items: [
    {
      id: 'old',
      source: 'tasks',
      title: 'Договор',
      description: 'Полная заметка: номер 123',
      context: 'Работа',
      date: '2020-01-01',
      status: 'done',
    },
  ],
}

function renderSearch() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  })
  const onClose = vi.fn()
  render(
    <QueryClientProvider client={client}>
      <PlannerSearchDialog onClose={onClose} />
    </QueryClientProvider>,
  )
  return { client, onClose }
}
describe('PlannerSearchDialog', () => {
  beforeEach(() => {
    mocks.shared = false
    mocks.search.mockReset()
    mocks.search.mockResolvedValue(found)
  })
  afterEach(() => {
    cleanup()
    onlineManager.setOnline(true)
  })
  it('closes with Escape while the search input is focused', () => {
    const { onClose } = renderSearch()
    fireEvent.change(screen.getByRole('searchbox'), {
      target: { value: 'договор' },
    })
    fireEvent.keyDown(screen.getByRole('searchbox'), { key: 'Escape' })
    expect(onClose).toHaveBeenCalledOnce()
  })
  it('shows an offline state and resumes searching when the connection returns', async () => {
    onlineManager.setOnline(false)
    renderSearch()
    fireEvent.change(screen.getByRole('searchbox'), {
      target: { value: 'договор' },
    })
    expect(await screen.findByText('Поиск временно недоступен')).toBeVisible()
    expect(screen.queryByText('Ищем…')).not.toBeInTheDocument()
    expect(mocks.search).not.toHaveBeenCalled()
    onlineManager.setOnline(true)
    expect(await screen.findByRole('button', { name: /Договор/ })).toBeVisible()
  })
  it('focuses search, includes completed records and opens full notes without losing the query', async () => {
    renderSearch()
    const input = screen.getByRole('searchbox')
    expect(input).toHaveFocus()
    fireEvent.change(input, { target: { value: 'номер' } })
    expect(mocks.search).not.toHaveBeenCalled()
    fireEvent.click(await screen.findByRole('button', { name: /Договор/ }))
    expect(screen.getByText('Полная заметка: номер 123')).toBeVisible()
    expect(mocks.search).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        query: 'номер',
        includeCompleted: true,
        page: 1,
      }),
      expect.any(AbortSignal),
    )
    fireEvent.click(screen.getByRole('button', { name: '← К результатам' }))
    expect(screen.getByRole('searchbox')).toHaveValue('номер')
    fireEvent.click(
      screen.getByRole('checkbox', { name: 'Включать выполненные' }),
    )
    await waitFor(() =>
      expect(mocks.search).toHaveBeenLastCalledWith(
        expect.anything(),
        expect.objectContaining({ includeCompleted: false }),
        expect.any(AbortSignal),
      ),
    )
  })
  it('loads more results and keeps section filters in the request', async () => {
    mocks.search
      .mockResolvedValueOnce({ ...found, hasMore: true })
      .mockResolvedValue({
        ...found,
        page: 2,
        items: [{ ...found.items[0], id: 'next', title: 'Другой договор' }],
      })
    renderSearch()
    fireEvent.click(screen.getByRole('button', { name: 'Задачи' }))
    fireEvent.change(screen.getByRole('searchbox'), {
      target: { value: 'договор' },
    })
    fireEvent.click(await screen.findByRole('button', { name: 'Показать ещё' }))
    await screen.findByRole('button', { name: /Другой договор/ })
    expect(mocks.search).toHaveBeenLastCalledWith(
      expect.anything(),
      expect.objectContaining({ page: 2, source: 'tasks' }),
      expect.any(AbortSignal),
    )
    expect(screen.getAllByText('Выполнено')).toHaveLength(2)
  })
  it('reports partial failure without calling it an empty result, and retries', async () => {
    mocks.search.mockResolvedValueOnce({
      ...found,
      items: [],
      unavailableSources: ['tasks'],
    })
    renderSearch()
    fireEvent.change(screen.getByRole('searchbox'), {
      target: { value: 'номер' },
    })
    expect(await screen.findByText('Часть разделов недоступна')).toBeVisible()
    expect(screen.queryByText(/Ничего не найдено/)).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Повторить' }))
    expect(await screen.findByRole('button', { name: /Договор/ })).toBeVisible()
  })
  it('cancels the previous request when the query changes and hides private care in shared spaces', async () => {
    mocks.shared = true
    mocks.search.mockImplementation(() => new Promise(() => {}))
    const { client } = renderSearch()
    expect(
      screen.queryByRole('button', { name: 'Забота' }),
    ).not.toBeInTheDocument()
    fireEvent.change(screen.getByRole('searchbox'), {
      target: { value: 'первый' },
    })
    await waitFor(() => expect(mocks.search).toHaveBeenCalledTimes(1))
    const signal = mocks.search.mock.calls[0]?.[2] as AbortSignal
    fireEvent.change(screen.getByRole('searchbox'), {
      target: { value: 'второй' },
    })
    await waitFor(() => expect(mocks.search).toHaveBeenCalledTimes(2))
    expect(signal.aborted).toBe(true)
    client.clear()
  })
})
