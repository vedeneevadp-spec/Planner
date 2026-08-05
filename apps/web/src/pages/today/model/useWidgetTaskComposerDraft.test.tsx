import { cleanup, render, screen, waitFor } from '@testing-library/react'
import { useEffect } from 'react'
import { MemoryRouter, useLocation } from 'react-router'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { TaskComposerDraft } from '@/features/task-create'

import { useWidgetTaskComposerDraft } from './useWidgetTaskComposerDraft'

function DraftProbe({
  onDraft,
  todayKey,
}: {
  onDraft: (draft: TaskComposerDraft | null) => void
  todayKey: string
}) {
  const draft = useWidgetTaskComposerDraft(todayKey)
  const location = useLocation()

  useEffect(() => {
    onDraft(draft)
  }, [draft, onDraft])

  return <output data-testid="search-params">{location.search}</output>
}

describe('useWidgetTaskComposerDraft', () => {
  afterEach(() => {
    cleanup()
  })

  it('creates one draft and removes only createTask from the URL', async () => {
    const onDraft = vi.fn()

    render(
      <MemoryRouter
        initialEntries={['/today?taskView=list&createTask=request-1&foo=bar']}
      >
        <DraftProbe onDraft={onDraft} todayKey="2026-05-20" />
      </MemoryRouter>,
    )

    expect(onDraft).toHaveBeenCalledWith({
      plannedDate: '2026-05-20',
      requestId: 'request-1',
    })
    await waitFor(() => {
      expect(screen.getByTestId('search-params')).toHaveTextContent(
        '?taskView=list&foo=bar',
      )
    })
    expect(onDraft).toHaveBeenCalledWith(null)
  })

  it('does not create a draft without the widget query parameter', () => {
    const onDraft = vi.fn()

    render(
      <MemoryRouter initialEntries={['/today?taskView=list']}>
        <DraftProbe onDraft={onDraft} todayKey="2026-05-20" />
      </MemoryRouter>,
    )

    expect(onDraft).toHaveBeenCalledWith(null)
    expect(screen.getByTestId('search-params')).toHaveTextContent(
      '?taskView=list',
    )
  })
})
