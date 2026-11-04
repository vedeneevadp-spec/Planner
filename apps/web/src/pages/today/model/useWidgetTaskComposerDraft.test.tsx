import { cleanup, render, screen, waitFor } from '@testing-library/react'
import { useEffect } from 'react'
import { MemoryRouter, useLocation } from 'react-router'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { TaskComposerDraft } from '@/features/task-create'

import { useWidgetTaskComposerDraft } from './useWidgetTaskComposerDraft'

function DraftProbe({
  onDraft,
}: {
  onDraft: (draft: TaskComposerDraft | null) => void
}) {
  const draft = useWidgetTaskComposerDraft()
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
        <DraftProbe onDraft={onDraft} />
      </MemoryRouter>,
    )

    expect(onDraft).toHaveBeenCalledWith({
      plannedDate: null,
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
        <DraftProbe onDraft={onDraft} />
      </MemoryRouter>,
    )

    expect(onDraft).toHaveBeenCalledWith(null)
    expect(screen.getByTestId('search-params')).toHaveTextContent(
      '?taskView=list',
    )
  })
})
