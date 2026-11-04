import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react'
import { useEffect } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { type AndroidAppUpdateState } from '../lib/native-app-updates'
import { useAppUpdate } from '../model/app-update-store'
import { AppUpdatesProvider } from './AppUpdatesProvider'

const mocks = vi.hoisted(() => ({
  android: vi.fn(() => true),
  getState: vi.fn(),
  check: vi.fn(),
  download: vi.fn(),
  install: vi.fn(),
  dismiss: vi.fn(),
  stateListener: vi.fn(),
  appListener: vi.fn(),
  remove: vi.fn(),
}))
vi.mock('@/shared/lib/native-runtime', () => ({
  isAndroidNativeRuntime: mocks.android,
}))
vi.mock('../lib/native-app-updates', () => ({
  nativeAppUpdates: {
    getState: mocks.getState,
    check: mocks.check,
    download: mocks.download,
    install: mocks.install,
    dismiss: mocks.dismiss,
    addListener: mocks.stateListener,
  },
}))
vi.mock('@capacitor/app', () => ({ App: { addListener: mocks.appListener } }))

const current: AndroidAppUpdateState = {
  installedVersion: '1.1.27',
  installedBuild: 35,
  update: null,
  downloading: false,
  downloaded: false,
  progress: 0,
  dismissed: false,
}
const available: AndroidAppUpdateState = {
  ...current,
  update: {
    versionCode: 36,
    versionName: '1.1.28',
    sizeBytes: 6000000,
    notes: 'Обновления внутри приложения.',
  },
}
function ManualCheck() {
  const updates = useAppUpdate()
  return updates ? (
    <button disabled={updates.busy} onClick={updates.check}>
      Проверить вручную
    </button>
  ) : null
}
function mount() {
  return render(
    <AppUpdatesProvider>
      <p>Мои задачи</p>
      <ManualCheck />
    </AppUpdatesProvider>,
  )
}

describe('Android app updates', () => {
  afterEach(cleanup)
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.android.mockReturnValue(true)
    mocks.getState.mockResolvedValue(current)
    mocks.check.mockResolvedValue(available)
    mocks.download.mockResolvedValue({ ...available, downloaded: true })
    mocks.install.mockResolvedValue(undefined)
    mocks.dismiss.mockResolvedValue({ ...available, dismissed: true })
    mocks.stateListener.mockResolvedValue({ remove: mocks.remove })
    mocks.appListener.mockResolvedValue({ remove: mocks.remove })
  })

  it('leaves browser/iOS UI and native APIs alone', () => {
    mocks.android.mockReturnValue(false)
    mount()
    expect(screen.getByText('Мои задачи')).toBeVisible()
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
    expect(mocks.getState).not.toHaveBeenCalled()
    expect(mocks.check).not.toHaveBeenCalled()
  })

  it('stays quiet when the automatic check fails and keeps planner usable', async () => {
    mocks.check.mockRejectedValue(new Error('Offline'))
    mount()
    await waitFor(() =>
      expect(mocks.check).toHaveBeenCalledWith({ force: false }),
    )
    expect(
      screen.queryByLabelText('Обновление Хаотики'),
    ).not.toBeInTheDocument()
    expect(screen.getByText('Мои задачи')).toBeVisible()
  })

  it('keeps the planner mounted while the Android module loads and updates its controls', async () => {
    const started = vi.fn()
    const stopped = vi.fn()
    function Planner() {
      useEffect(() => {
        started()
        return stopped
      }, [])
      return <p>Планнер открыт</p>
    }
    render(
      <AppUpdatesProvider>
        <Planner />
      </AppUpdatesProvider>,
    )
    expect(screen.getByText('Планнер открыт')).toBeVisible()
    await screen.findByRole('button', { name: 'Обновить' })
    expect(started).toHaveBeenCalledOnce()
    expect(stopped).not.toHaveBeenCalled()
  })

  it('downloads only after a tap and then opens the system installer', async () => {
    mount()
    const update = await screen.findByRole('button', {
      name: 'Обновить',
    })
    await waitFor(() => expect(update).toBeEnabled())
    expect(mocks.download).not.toHaveBeenCalled()
    fireEvent.click(update)
    await waitFor(() => expect(mocks.install).toHaveBeenCalledOnce())
    expect(mocks.download).toHaveBeenCalledOnce()
    expect(
      await screen.findByRole('button', { name: 'Установить' }),
    ).toBeEnabled()
  })

  it('honors Later and allows a manual check of a dismissed version', async () => {
    mocks.getState.mockResolvedValue({ ...available, dismissed: true })
    mocks.check.mockResolvedValue({ ...available, dismissed: true })
    mount()
    const check = await screen.findByRole('button', {
      name: 'Проверить вручную',
    })
    await waitFor(() => expect(check).toBeEnabled())
    expect(
      screen.queryByRole('button', { name: 'Обновить' }),
    ).not.toBeInTheDocument()
    fireEvent.click(check)
    expect(
      await screen.findByRole('button', { name: 'Обновить' }),
    ).toBeVisible()
    expect(mocks.check).toHaveBeenLastCalledWith({ force: true })
    fireEvent.click(screen.getByRole('button', { name: 'Позже' }))
    await waitFor(() =>
      expect(
        screen.queryByLabelText('Обновление Хаотики'),
      ).not.toBeInTheDocument(),
    )
    expect(mocks.dismiss).toHaveBeenCalledOnce()
  })

  it('reports no update only for a manual check', async () => {
    mocks.check.mockResolvedValue(current)
    mount()
    const check = await screen.findByRole('button', {
      name: 'Проверить вручную',
    })
    await waitFor(() => expect(mocks.check).toHaveBeenCalled())
    await waitFor(() => expect(check).toBeEnabled())
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
    fireEvent.click(check)
    expect(await screen.findByRole('status')).toHaveTextContent(
      'Установлена последняя версия',
    )
  })

  it('offers the update again after native dismissal expires while the app remains open', async () => {
    mount()
    await screen.findByRole('button', { name: 'Позже' })
    fireEvent.click(screen.getByRole('button', { name: 'Позже' }))
    await waitFor(() => expect(mocks.dismiss).toHaveBeenCalled())
    const listener = mocks.stateListener.mock.calls[0]![1] as (
      state: AndroidAppUpdateState,
    ) => void
    act(() => listener({ ...available, dismissed: true }))
    expect(
      screen.queryByLabelText('Обновление Хаотики'),
    ).not.toBeInTheDocument()
    act(() => listener({ ...available, dismissed: false }))
    expect(screen.getByRole('button', { name: 'Обновить' })).toBeVisible()
  })

  it('offers retry after a failed download without opening the installer', async () => {
    mocks.download.mockRejectedValue(new Error('Network lost'))
    mocks.getState.mockResolvedValue(available)
    mount()
    const update = await screen.findByRole('button', { name: 'Обновить' })
    await waitFor(() => expect(update).toBeEnabled())
    fireEvent.click(update)
    expect(await screen.findByRole('status')).toHaveTextContent(
      'Не удалось обновить',
    )
    expect(mocks.install).not.toHaveBeenCalled()
    await waitFor(() => expect(update).toBeEnabled())
  })

  it('reuses the downloaded APK after the Android permission is declined', async () => {
    const ready = { ...available, downloaded: true }
    mocks.check.mockResolvedValue(ready)
    mocks.getState.mockResolvedValue(ready)
    mocks.install.mockRejectedValueOnce({ code: 'INSTALL_PERMISSION' })
    mount()
    const install = await screen.findByRole('button', { name: 'Установить' })
    await waitFor(() => expect(install).toBeEnabled())
    fireEvent.click(install)
    expect(await screen.findByRole('status')).toHaveTextContent(
      'разрешите установку из Хаотики',
    )
    await waitFor(() => expect(install).toBeEnabled())
    fireEvent.click(install)
    await waitFor(() => expect(mocks.install).toHaveBeenCalledTimes(2))
    expect(mocks.download).not.toHaveBeenCalled()
  })

  it('shows progress and does not reopen a hidden download on each progress event', async () => {
    mount()
    await screen.findByRole('button', { name: 'Обновить' })
    const listener = mocks.stateListener.mock.calls[0]![1] as (
      state: AndroidAppUpdateState,
    ) => void
    act(() => listener({ ...available, downloading: true, progress: 40 }))
    expect(screen.getByRole('progressbar')).toHaveAttribute('value', '40')
    fireEvent.click(screen.getByRole('button', { name: 'Скрыть' }))
    act(() => listener({ ...available, downloading: true, progress: 60 }))
    expect(
      screen.queryByLabelText('Обновление Хаотики'),
    ).not.toBeInTheDocument()
  })
})
