import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { PageStateView, PageStatusBanner } from './PageState'

describe('PageStateView', () => {
  afterEach(() => {
    cleanup()
  })

  it('announces loading while keeping the skeleton decorative', () => {
    render(
      <PageStateView
        headingLevel={1}
        kind="loading"
        title="Загружаем заботу"
        skeletonVariant="cards"
      />,
    )

    expect(screen.getByRole('status')).toHaveAttribute('aria-busy', 'true')
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(
      'Загружаем заботу',
    )
    expect(screen.getByText('Загружаем заботу')).toBeInTheDocument()
    expect(screen.getByTestId('page-state-skeleton')).toHaveAttribute(
      'aria-hidden',
      'true',
    )
  })

  it('renders an error as an alert and calls the retry action', () => {
    const onRetry = vi.fn()

    render(
      <PageStateView
        kind="error"
        title="Не удалось открыть страницу"
        action={{ label: 'Повторить', onClick: onRetry }}
      />,
    )

    expect(screen.getByRole('alert')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Повторить' }))
    expect(onRetry).toHaveBeenCalledTimes(1)
  })

  it('exposes a busy action as disabled instead of accepting duplicate work', () => {
    const onAction = vi.fn()

    render(
      <PageStateView
        kind="empty"
        action={{
          disabled: true,
          label: 'Добавляем...',
          onClick: onAction,
        }}
      />,
    )

    const action = screen.getByRole('button', { name: 'Добавляем...' })
    expect(action).toBeDisabled()
    expect(action).toHaveAttribute('aria-busy', 'true')
    fireEvent.click(action)
    expect(onAction).not.toHaveBeenCalled()
  })

  it('renders a link action without converting it to a button', () => {
    render(
      <PageStateView
        kind="unavailable"
        action={{
          href: 'mailto:support@chaotika.ru?subject=Доступ',
          label: 'Запросить доступ',
        }}
      />,
    )

    expect(
      screen.getByRole('link', { name: 'Запросить доступ' }),
    ).toHaveAttribute('href', 'mailto:support@chaotika.ru?subject=Доступ')
    expect(
      screen.queryByRole('button', { name: 'Запросить доступ' }),
    ).not.toBeInTheDocument()
  })

  it('formats a valid last-sync timestamp in Russian and omits invalid dates', () => {
    const { rerender } = render(
      <PageStateView
        kind="offline"
        lastSyncedAt={new Date(2026, 7, 6, 14, 25)}
      />,
    )

    expect(
      screen.getByText('Последняя синхронизация: 6 августа 2026 г. в 14:25'),
    ).toHaveAttribute('datetime', new Date(2026, 7, 6, 14, 25).toISOString())

    rerender(<PageStateView kind="offline" lastSyncedAt="not-a-date" />)
    expect(
      screen.queryByText(/Последняя синхронизация:/),
    ).not.toBeInTheDocument()
  })
})

describe('PageStatusBanner', () => {
  afterEach(() => {
    cleanup()
  })

  it('keeps cached-content errors visible and retryable', () => {
    const onRetry = vi.fn()

    render(
      <PageStatusBanner
        kind="error"
        description="Показываем сохранённый список."
        lastSyncedAt={new Date(2026, 7, 6, 10, 5)}
        action={{ label: 'Обновить', onClick: onRetry }}
      />,
    )

    expect(screen.getByRole('alert')).toHaveTextContent(
      'Показываем сохранённый список.',
    )
    expect(screen.getByRole('alert')).toHaveTextContent(
      'Последняя синхронизация: 6 августа 2026 г. в 10:05',
    )

    fireEvent.click(screen.getByRole('button', { name: 'Обновить' }))
    expect(onRetry).toHaveBeenCalledTimes(1)
  })

  it('announces restoring access without treating it as an error', () => {
    render(
      <PageStatusBanner
        kind="info"
        showUnknownLastSync
        title="Восстанавливаем доступ"
      />,
    )

    expect(screen.getByRole('status')).toHaveTextContent(
      'Восстанавливаем доступ',
    )
    expect(screen.getByRole('status')).toHaveTextContent(
      'Время последней синхронизации неизвестно',
    )
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })
})
