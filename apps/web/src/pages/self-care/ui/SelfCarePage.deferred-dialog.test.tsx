import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { DeferredSelfCareDialog } from './SelfCarePage.deferred-dialog'

const copy = {
  loadingTitle: 'Открываем тестовое окно',
  unavailableTitle: 'Не удалось открыть тестовое окно',
}

describe('DeferredSelfCareDialog', () => {
  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
  })

  it('shows a modal skeleton while loading and keeps close available', () => {
    const onClose = vi.fn()

    render(
      <DeferredSelfCareDialog
        copy={copy}
        dialogProps={{ label: 'Готово', onClose }}
        loadDialog={() =>
          new Promise<{ default: typeof TestDialog }>(() => undefined)
        }
      />,
    )

    expect(
      screen.getByRole('dialog', { name: copy.loadingTitle }),
    ).toBeVisible()
    expect(screen.getByTestId('page-state-skeleton')).toBeVisible()

    fireEvent.click(screen.getAllByRole('button', { name: 'Закрыть окно' })[1]!)
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('explains a failed load and retries with a fresh module attempt', async () => {
    vi.spyOn(window.navigator, 'onLine', 'get').mockReturnValue(true)
    vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const loadDialog = vi
      .fn<
        () => Promise<{
          default: typeof TestDialog
        }>
      >()
      .mockRejectedValueOnce(new Error('Chunk unavailable'))
      .mockResolvedValueOnce({ default: TestDialog })

    render(
      <DeferredSelfCareDialog
        copy={copy}
        dialogProps={{ label: 'Диалог загружен', onClose: vi.fn() }}
        loadDialog={loadDialog}
      />,
    )

    expect(
      await screen.findByRole('dialog', { name: copy.unavailableTitle }),
    ).toBeVisible()
    expect(
      screen.getByText(
        'Данные не изменились. Проверьте подключение и попробуйте снова.',
      ),
    ).toBeVisible()

    fireEvent.click(screen.getByRole('button', { name: 'Повторить' }))

    expect(
      await screen.findByRole('dialog', { name: 'Диалог загружен' }),
    ).toBeVisible()
    expect(loadDialog).toHaveBeenCalledTimes(2)
  })

  it('explains when an uncached dialog cannot open offline', async () => {
    vi.spyOn(window.navigator, 'onLine', 'get').mockReturnValue(false)
    vi.spyOn(console, 'warn').mockImplementation(() => undefined)

    render(
      <DeferredSelfCareDialog
        copy={copy}
        dialogProps={{ label: 'Готово', onClose: vi.fn() }}
        loadDialog={() =>
          Promise.reject<{ default: typeof TestDialog }>(new Error('Offline'))
        }
      />,
    )

    expect(
      await screen.findByRole('dialog', { name: copy.unavailableTitle }),
    ).toBeVisible()
    expect(
      screen.getByText(
        'Это окно ещё не сохранено на устройстве. Подключитесь к интернету и повторите.',
      ),
    ).toBeVisible()
  })
})

function TestDialog({ label }: { label: string; onClose: () => void }) {
  return <div aria-label={label} role="dialog" />
}
