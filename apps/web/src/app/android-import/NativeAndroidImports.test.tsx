import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react'
import { StrictMode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { CalendarEventDraft } from '@/features/calendar-event-import'

const mocks = vi.hoisted(() => ({
  read: vi.fn(),
  ack: vi.fn(),
  readShare: vi.fn(),
  ackShare: vi.fn(),
  pendingListener: undefined as (() => void) | undefined,
  resumeListener: undefined as
    ((state: { isActive: boolean }) => void) | undefined,
  loading: false,
}))
vi.mock(import('@/features/calendar-event-import'), async (importOriginal) => ({
  ...(await importOriginal()),
  nativeCalendarEvents: {
    readPendingEvent: mocks.read,
    acknowledgeEvent: mocks.ack,
    addListener: vi.fn((_name: string, listener: () => void) => {
      mocks.pendingListener = listener
      return Promise.resolve({ remove: vi.fn() })
    }),
  },
}))
vi.mock('@/features/android-share/native-incoming-shares', () => ({
  nativeIncomingShares: {
    readPendingShare: mocks.readShare,
    acknowledgeShare: mocks.ackShare,
    addListener: () => Promise.resolve({ remove: vi.fn() }),
  },
}))
vi.mock('@/features/android-share/SharedDraft', () => ({
  SharedDraft: ({
    share,
    onClose,
  }: {
    share: { text: string }
    onClose: (message?: string) => void
  }) => (
    <div role="dialog" aria-label="Поделиться">
      {share.text}
      <button onClick={() => onClose('Покупка добавлена')}>Сохранить</button>
    </div>
  ),
}))
vi.mock('@capacitor/app', () => ({
  App: {
    addListener: vi.fn(
      (_name: string, listener: (state: { isActive: boolean }) => void) => {
        mocks.resumeListener = listener
        return Promise.resolve({ remove: vi.fn() })
      },
    ),
  },
}))
vi.mock('@/features/planner', () => ({
  usePlanner: () => ({ isLoading: mocks.loading }),
}))
vi.mock('@/features/session', () => ({
  usePlannerTimeZone: () => 'Asia/Novosibirsk',
}))
vi.mock('@/features/task-create', () => ({
  TaskComposer: ({
    openDraft,
    onClose,
  }: {
    openDraft: { title: string }
    onClose: () => void
  }) => (
    <div role="dialog" aria-label="Новая задача">
      <input aria-label="Задача" defaultValue={openDraft.title} />
      <button onClick={onClose}>Закрыть</button>
    </div>
  ),
}))

import { NativeAndroidImports } from './NativeAndroidImports'

const event: CalendarEventDraft = {
  requestId: 'first',
  title: 'Встреча',
  description: '',
  location: '',
  beginTime: Date.parse('2026-11-05T11:40:00Z'),
  endTime: null,
  allDay: false,
}
let queue: CalendarEventDraft[]

describe('native calendar event import', () => {
  beforeEach(() => {
    mocks.readShare.mockReset().mockResolvedValue({ share: null })
    mocks.ackShare.mockReset().mockResolvedValue(undefined)
    queue = [event]
    mocks.loading = false
    mocks.read
      .mockReset()
      .mockImplementation(() => Promise.resolve({ event: queue[0] ?? null }))
    mocks.ack
      .mockReset()
      .mockImplementation(({ requestId }: { requestId: string }) => {
        queue = queue.filter((item) => item.requestId !== requestId)
        return Promise.resolve()
      })
  })
  afterEach(cleanup)

  it('queues a share behind the calendar draft and acknowledges it only after confirmation', async () => {
    mocks.readShare.mockResolvedValue({
      share: { requestId: 'share', text: 'Кружка', subject: '' },
    })
    mocks.ackShare.mockImplementation(() => {
      mocks.readShare.mockResolvedValue({ share: null })
      return Promise.resolve()
    })
    render(<NativeAndroidImports />)
    await screen.findByRole('dialog', { name: 'Новая задача' })
    expect(screen.queryByRole('dialog', { name: 'Поделиться' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Закрыть' }))
    await screen.findByRole('dialog', { name: 'Поделиться' })
    expect(mocks.ackShare).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Сохранить' }))
    await waitFor(() =>
      expect(mocks.ackShare).toHaveBeenCalledWith({ requestId: 'share' }),
    )
    expect(screen.getByRole('status')).toHaveTextContent('Покупка добавлена')
  })

  it('preserves a browser dialog and reads shares when the calendar plugin fails', async () => {
    mocks.read.mockRejectedValue(new Error('Unavailable'))
    mocks.readShare.mockResolvedValue({
      share: { requestId: 'share', text: 'Посылка', subject: '' },
    })
    const other = document.createElement('dialog')
    other.open = true
    document.body.append(other)
    render(<NativeAndroidImports />)
    expect(mocks.readShare).not.toHaveBeenCalled()
    act(() => {
      other.open = false
    })
    expect(
      await screen.findByRole('dialog', { name: 'Поделиться' }),
    ).toHaveTextContent('Посылка')
    other.remove()
  })

  it('retains the draft through StrictMode setup and acknowledges only after closing', async () => {
    render(
      <StrictMode>
        <NativeAndroidImports />
      </StrictMode>,
    )
    expect(await screen.findByRole('dialog')).toBeVisible()
    expect(screen.getByLabelText('Задача')).toHaveValue('Встреча')
    expect(mocks.ack).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Закрыть' }))
    await waitFor(() =>
      expect(mocks.ack).toHaveBeenCalledWith({ requestId: 'first' }),
    )
    await act(async () => {
      mocks.resumeListener?.({ isActive: true })
      await Promise.resolve()
    })
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('waits for an existing form to close before reading the incoming event', async () => {
    const other = document.createElement('div')
    other.setAttribute('role', 'dialog')
    document.body.append(other)
    render(<NativeAndroidImports />)
    expect(mocks.read).not.toHaveBeenCalled()
    act(() => other.remove())
    expect(await screen.findByLabelText('Задача')).toHaveValue('Встреча')
  })

  it('does not overwrite edited text when another event arrives', async () => {
    render(<NativeAndroidImports />)
    fireEvent.change(await screen.findByLabelText('Задача'), {
      target: { value: 'Моя правка' },
    })
    queue.push({ ...event, requestId: 'second', title: 'Второе событие' })
    await act(async () => {
      mocks.pendingListener?.()
      await Promise.resolve()
    })
    expect(screen.getByLabelText('Задача')).toHaveValue('Моя правка')
    fireEvent.click(screen.getByRole('button', { name: 'Закрыть' }))
    await waitFor(() =>
      expect(screen.getByLabelText('Задача')).toHaveValue('Второе событие'),
    )
  })

  it('waits until the planner has loaded and retries a failed native read on resume', async () => {
    mocks.loading = true
    const view = render(<NativeAndroidImports />)
    expect(mocks.read).not.toHaveBeenCalled()
    mocks.loading = false
    mocks.read.mockRejectedValueOnce(new Error('bridge unavailable'))
    view.rerender(<NativeAndroidImports />)
    await waitFor(() => expect(mocks.read).toHaveBeenCalledTimes(1))
    await act(async () => {
      mocks.resumeListener?.({ isActive: true })
      await Promise.resolve()
    })
    expect(await screen.findByLabelText('Задача')).toHaveValue('Встреча')
  })
})
